// src/services/parse/lspParser.ts
import * as vscode from 'vscode';
import { GraphArtifacts } from '../../shared/types';
import { snippetFrom, escapeReg } from '../../shared/text';
import {
  stripStringsAndComments,
  normalizeContinuations,
  resolveImportLabelByText,
  normalizePosixPath,
  makeModuleId,
  makeClassId,
  makeFuncId
} from './utils';

export async function parseWithLsp(uri: vscode.Uri, text: string): Promise<GraphArtifacts | null> {
  try {
    const fileLabel = vscode.workspace.asRelativePath(uri, false);
    const moduleLabelKey = normalizePosixPath(fileLabel);
    const moduleId = makeModuleId(moduleLabelKey);
    const nodes: any[] = [{
      id: moduleId,
      kind: 'module',
      label: fileLabel,
      fsPath: uri.fsPath,
      source: text
    }];
    const edges: any[] = [];

    const document = await vscode.workspace.openTextDocument(uri);
    const result = await vscode.commands.executeCommand<any>('vscode.executeDocumentSymbolProvider', uri);
    const symbols: vscode.DocumentSymbol[] = Array.isArray(result) ? result : [];

    type Fn = { id: string; name: string; start: number; end: number; col: number; parent: string };
    const functions: Fn[] = [];
    const classIds = new Map<string, string>();

    const addFunction = (name: string, selection: vscode.Range, full: vscode.Range, parent: string) => {
      const id = makeFuncId(fileLabel, name, selection.start.line);
      functions.push({
        id,
        name,
        start: selection.start.line,
        end: full.end.line,
        col: selection.start.character,
        parent
      });
    };

    const walk = (symbol: vscode.DocumentSymbol) => {
      if (symbol.kind === vscode.SymbolKind.Class) {
        const className = symbol.name;
        if (!classIds.has(className)) {
          const classId = makeClassId(fileLabel, className);
          classIds.set(className, classId);
          nodes.push({
            id: classId,
            kind: 'class',
            label: className,
            parent: moduleId,
            docked: true,
            snippet: document.getText(symbol.range).split(/\r?\n/).slice(0, 20).join('\n'),
            fsPath: uri.fsPath,
            range: { line: symbol.selectionRange.start.line, col: symbol.selectionRange.start.character }
          });
        }
        for (const child of symbol.children || []) {
          if (child.kind === vscode.SymbolKind.Method || child.kind === vscode.SymbolKind.Function) {
            const classId = classIds.get(className)!;
            addFunction(`${symbol.name}.${child.name}`, child.selectionRange ?? child.range, child.range, classId);
          }
        }
      } else if (symbol.kind === vscode.SymbolKind.Function) {
        addFunction(symbol.name, symbol.selectionRange ?? symbol.range, symbol.range, moduleId);
      }
      for (const child of symbol.children || []) {
        walk(child);
      }
    };

    symbols.forEach(walk);

    if (!functions.length) {
      return null;
    }

    const lines = text.split(/\r?\n/);
    for (const fn of functions) {
      nodes.push({
        id: fn.id,
        kind: 'func',
        label: fn.name,
        parent: fn.parent,
        docked: true,
        snippet: snippetFrom(lines, fn.start),
        fsPath: uri.fsPath,
        range: { line: fn.start, col: fn.col }
      });
    }

    const bare = (name: string) => (name.includes('.') ? name.split('.').pop() || name : name);
    const nameToIds = new Map<string, string[]>();
    for (const fn of functions) {
      const key = bare(fn.name);
      if (!nameToIds.has(key)) {
        nameToIds.set(key, []);
      }
      nameToIds.get(key)!.push(fn.id);
    }

    const regexCache = new Map<string, RegExp>();
    const wcr = (token: string) => new RegExp(String.raw`\b${escapeReg(token)}\s*\(`);
    const bodyOf = (fn: Fn) => {
      try {
        return document.getText(new vscode.Range(new vscode.Position(fn.start, 0), new vscode.Position(fn.end + 1, 0)));
      } catch {
        return lines.slice(fn.start, fn.end + 1).join('\n');
      }
    };

    for (const fn of functions) {
      const body = stripStringsAndComments(bodyOf(fn));
      for (const [calleeToken, ids] of nameToIds) {
        if (ids.includes(fn.id)) {
          continue;
        }
        const bareToken = bare(calleeToken);
        let regex = regexCache.get(bareToken);
        if (!regex) {
          regex = wcr(bareToken);
          regexCache.set(bareToken, regex);
        }
        if (regex.test(body) || (calleeToken !== bareToken && wcr(calleeToken).test(body))) {
          edges.push({ from: fn.id, to: ids[0], type: 'call' });
        }
      }
    }

    const importsSource = normalizeContinuations(stripStringsAndComments(text));
    const impPy = /(?:^|\n)\s*(?:from\s+([\w\.]+)\s+import\s+([A-Za-z0-9_\,\s\*\.]+)|import\s+([\w\.]+)(?:\s+as\s+\w+)?)/g;
    const impTs = /(?:^|\n)\s*(?:import\s+(?:[^'"]+)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|export\s+[^;]+?\s+from\s+['"]([^'"]+)['"])/g;
    let match: RegExpExecArray | null;

    while ((match = impPy.exec(importsSource)) !== null) {
      const target = (match[1] ?? match[3] ?? '').trim();
      if (!target) {
        continue;
      }
      const label = resolveImportLabelByText(fileLabel, target, 'py');
      const to = makeModuleId(label ?? target);
      edges.push({ from: moduleId, to, type: 'import' });
    }

    while ((match = impTs.exec(importsSource)) !== null) {
      const target = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
      if (!target) {
        continue;
      }
      const label = resolveImportLabelByText(fileLabel, target, 'ts');
      const to = makeModuleId(label ?? target);
      edges.push({ from: moduleId, to, type: 'import' });
    }

    return { nodes, edges };
  } catch {
    return null;
  }
}

