import * as vscode from 'vscode';
import { escapeReg } from '../parse/shared';

export async function gotoSymbol(target: { file?: string; name: string }, peek: boolean, beside: boolean) {
  try {
    if (!target || !target.name) return;
    const loc = await resolveSymbolLocation(target);
    if (!loc) { vscode.window.showWarningMessage(`DepViz: couldn't find "${target.name}".`); return; }
    const doc = await vscode.workspace.openTextDocument(loc.uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: beside ? vscode.ViewColumn.Beside : undefined, preserveFocus: false });
    const defLine = loc.range.start.line;
    const lineText = doc.lineAt(defLine).text;
    const nameRe = new RegExp(`\\b${escapeReg(target.name)}\\b`);
    const m = nameRe.exec(lineText);
    if (peek && m) {
      const pos = new vscode.Position(defLine, m.index);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(new vscode.Position(defLine, 0), new vscode.Position(defLine, Math.max(0, lineText.length))), vscode.TextEditorRevealType.InCenter);
    } else {
      const lineRange = new vscode.Range(new vscode.Position(defLine, 0), new vscode.Position(defLine, Math.max(0, lineText.length)));
      editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
      editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);
    }
    if (peek) { try { await vscode.commands.executeCommand('editor.action.referenceSearch.trigger'); } catch {} }
  } catch (e: any) {
    vscode.window.showErrorMessage(e?.message || String(e));
  }
}

export async function resolveSymbolLocation(target: { file?: string; name: string }): Promise<vscode.Location | null> {
  const name = target.name;
  if (target.file) {
    const uri = vscode.Uri.file(target.file);
    const inFile = await lookupInFile(uri, name);
    if (inFile) return inFile;
  }
  const inWs = await lookupInWorkspace(name);
  if (inWs) return inWs;
  if (target.file) {
    const uri = vscode.Uri.file(target.file);
    const scan = await regexScan(uri, name);
    if (scan) return scan;
  }
  return null;
}

async function lookupInFile(uri: vscode.Uri, name: string): Promise<vscode.Location | null> {
  const res = await vscode.commands.executeCommand<any>('vscode.executeDocumentSymbolProvider', uri);
  const symbols: vscode.DocumentSymbol[] = Array.isArray(res) ? res : [];
  const flat: vscode.DocumentSymbol[] = [];
  const walk = (s: vscode.DocumentSymbol) => { flat.push(s); s.children?.forEach(walk); };
  symbols.forEach(walk);
  const last = (name || '').split('.').pop() || name;
  const cand = flat.find(s => s.name === name)
          || flat.find(s => s.name === last)
          || flat.find(s => (s.name.split('.').pop() || s.name) === last)
          || flat.find(s => s.name.toLowerCase() === last.toLowerCase());
  return cand ? new vscode.Location(uri, cand.selectionRange ?? cand.range) : null;
}

async function lookupInWorkspace(name: string): Promise<vscode.Location | null> {
  const res = await vscode.commands.executeCommand<any>('vscode.executeWorkspaceSymbolProvider', name);
  const infos: vscode.SymbolInformation[] = Array.isArray(res) ? res : [];
  const last = (name || '').split('.').pop() || name;
  const FN = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]);
  const fns = infos.filter(s => FN.has(s.kind));
  const pick = fns.find(s => s.name === name)
      || fns.find(s => s.name === last)
      || fns.find(s => (s.name.split('.').pop() || s.name) === last)
      || fns.find(s => s.name.toLowerCase() === last.toLowerCase()) || null;
  return pick ? pick.location : null;
}

async function regexScan(uri: vscode.Uri, name: string): Promise<vscode.Location | null> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    let m = new RegExp(String.raw`\b${escapeReg(name)}\s*\(`, 'g').exec(text);
    if (m) {
      const pos = doc.positionAt(m.index);
      return new vscode.Location(uri, new vscode.Range(pos, pos.translate(0, name.length)));
    }
    const defs = [
      new RegExp(String.raw`^\s*def\s+${escapeReg(name)}\s*\(`, 'm'),
      new RegExp(String.raw`^\s*(?:export\s+)?function\s+${escapeReg(name)}\s*\(`, 'm'),
      new RegExp(String.raw`^\s*(?:public|private|protected|static\s+)*${escapeReg(name)}\s*\(`, 'm')
    ];
    for (const re of defs) {
      m = re.exec(text);
      if (m) {
        const pos = doc.positionAt(m.index);
        return new vscode.Location(uri, new vscode.Range(pos, pos.translate(0, name.length)));
      }
    }
  } catch {}
  return null;
}
