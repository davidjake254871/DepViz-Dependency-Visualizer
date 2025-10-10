// src/services/navigation/gotoSymbol.ts
import * as vscode from 'vscode';
import { escapeReg } from '../../shared/text';

export interface SymbolTarget {
  file?: string;
  name: string;
}

export type GotoSymbolFn = (target: SymbolTarget, peek: boolean, beside: boolean) => Promise<void>;

export const gotoSymbol: GotoSymbolFn = async (target, peek, beside) => {
  try {
    if (!target || !target.name) {
      return;
    }
    const location = await resolveSymbolLocation(target);
    if (!location) {
      vscode.window.showWarningMessage(`DepViz: couldn't find "${target.name}".`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: beside ? vscode.ViewColumn.Beside : undefined,
      preserveFocus: false
    });

    const defLine = location.range.start.line;
    const lineText = doc.lineAt(defLine).text;
    const nameRe = new RegExp(`\\b${escapeReg(target.name)}\\b`);
    const match = nameRe.exec(lineText);
    if (peek && match) {
      const pos = new vscode.Position(defLine, match.index);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(
        new vscode.Range(new vscode.Position(defLine, 0), new vscode.Position(defLine, Math.max(0, lineText.length))),
        vscode.TextEditorRevealType.InCenter
      );
    } else {
      const lineRange = new vscode.Range(
        new vscode.Position(defLine, 0),
        new vscode.Position(defLine, Math.max(0, lineText.length))
      );
      editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
      editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);
    }

    if (peek) {
      try {
        await vscode.commands.executeCommand('editor.action.referenceSearch.trigger');
      } catch {
        // optional command, ignore failures
      }
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(err?.message || String(err));
  }
};

async function resolveSymbolLocation(target: SymbolTarget): Promise<vscode.Location | null> {
  const name = target.name;
  if (target.file) {
    const uri = vscode.Uri.file(target.file);
    const inFile = await lookupInFile(uri, name);
    if (inFile) {
      return inFile;
    }
  }
  const inWorkspace = await lookupInWorkspace(name);
  if (inWorkspace) {
    return inWorkspace;
  }
  if (target.file) {
    const uri = vscode.Uri.file(target.file);
    const scan = await regexScan(uri, name);
    if (scan) {
      return scan;
    }
  }
  return null;
}

async function lookupInFile(uri: vscode.Uri, name: string): Promise<vscode.Location | null> {
  const res = await vscode.commands.executeCommand<any>('vscode.executeDocumentSymbolProvider', uri);
  const symbols: vscode.DocumentSymbol[] = Array.isArray(res) ? res : [];
  const flat: vscode.DocumentSymbol[] = [];
  const walk = (symbol: vscode.DocumentSymbol) => {
    flat.push(symbol);
    symbol.children?.forEach(walk);
  };
  symbols.forEach(walk);
  const last = (name || '').split('.').pop() || name;
  const candidate =
    flat.find(s => s.name === name) ||
    flat.find(s => s.name === last) ||
    flat.find(s => (s.name.split('.').pop() || s.name) === last) ||
    flat.find(s => s.name.toLowerCase() === last.toLowerCase());
  return candidate ? new vscode.Location(uri, candidate.selectionRange ?? candidate.range) : null;
}

async function lookupInWorkspace(name: string): Promise<vscode.Location | null> {
  const res = await vscode.commands.executeCommand<any>('vscode.executeWorkspaceSymbolProvider', name);
  const infos: vscode.SymbolInformation[] = Array.isArray(res) ? res : [];
  const last = (name || '').split('.').pop() || name;
  const functionKinds = new Set([
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Constructor
  ]);
  const filtered = infos.filter(s => functionKinds.has(s.kind));
  const pick =
    filtered.find(s => s.name === name) ||
    filtered.find(s => s.name === last) ||
    filtered.find(s => (s.name.split('.').pop() || s.name) === last) ||
    filtered.find(s => s.name.toLowerCase() === last.toLowerCase()) ||
    null;
  return pick ? pick.location : null;
}

async function regexScan(uri: vscode.Uri, name: string): Promise<vscode.Location | null> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    let match = new RegExp(String.raw`\b${escapeReg(name)}\s*\(`, 'g').exec(text);
    if (match) {
      const pos = doc.positionAt(match.index);
      return new vscode.Location(uri, new vscode.Range(pos, pos.translate(0, name.length)));
    }
    const definitions = [
      new RegExp(String.raw`^\s*def\s+${escapeReg(name)}\s*\(`, 'm'),
      new RegExp(String.raw`^\s*(?:export\s+)?function\s+${escapeReg(name)}\s*\(`, 'm'),
      new RegExp(String.raw`^\s*(?:public|private|protected|static\s+)*${escapeReg(name)}\s*\(`, 'm')
    ];
    for (const re of definitions) {
      match = re.exec(text);
      if (match) {
        const pos = doc.positionAt(match.index);
        return new vscode.Location(uri, new vscode.Range(pos, pos.translate(0, name.length)));
      }
    }
  } catch {
    // fall through
  }
  return null;
}
