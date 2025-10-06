import * as vscode from 'vscode';
import { fnv1aHex } from '../utils/hash';
import { snippetFrom, stripStringsAndComments, normalizeContinuations, resolveImportLabelByText, escapeReg } from './shared';

export async function parseWithLsp(uri: vscode.Uri, text: string) {
  const fileLabel = vscode.workspace.asRelativePath(uri, false);
  const moduleLabelKey = fileLabel.replace(/\\/g,'/');
  const moduleId = `mod_${fnv1aHex(moduleLabelKey)}`;
  const nodes: any[] = [{ id: moduleId, kind: 'module', label: fileLabel, fsPath: uri.fsPath, source: text }];
  const edges: any[] = [];

  const doc = await vscode.workspace.openTextDocument(uri);
  const res = await vscode.commands.executeCommand<any>('vscode.executeDocumentSymbolProvider', uri);
  const symbols: vscode.DocumentSymbol[] = Array.isArray(res) ? res : [];
  const isTsLike = /^(typescript|javascript)/i.test(doc.languageId);

  type Fn = { id: string; name: string; start: number; end: number; col: number; parent: string };
  const fns: Fn[] = [];
  const classIds = new Map<string,string>();

  const addFn = (name: string, sel: vscode.Range, full: vscode.Range, parent: string) => {
    const id = `fn_${fnv1aHex(fileLabel + ':' + name + ':' + sel.start.line)}`;
    fns.push({ id, name, start: sel.start.line, end: full.end.line, col: sel.start.character, parent });
  };

  const isInlineTsCallback = (doc: vscode.TextDocument, sel: vscode.Range) => {
    try {
      const line = sel.start.line;
      const col  = sel.start.character;
      const L = doc.lineAt(line).text;
      const prefix = L.slice(0, col).trimEnd();
      if (/[(:,]\s*$/.test(prefix)) return true;
      if (/\=\s*$/.test(prefix)) return false;
    } catch {}
    return false;
  };

  const walk = (s: vscode.DocumentSymbol, parentKind: string) => {
    if (s.kind === vscode.SymbolKind.Class) {
      const className = s.name;
      if (!classIds.has(className)) {
        const clsId = `cls_${fnv1aHex(fileLabel + ':' + className)}`;
        classIds.set(className, clsId);
        nodes.push({ id: clsId, kind: 'class', label: `class ${className}`, parent: moduleId, docked: true,
          snippet: doc.getText(s.range).split(/\r?\n/).slice(0,20).join('\n'), fsPath: uri.fsPath, range: { line: s.selectionRange.start.line, col: s.selectionRange.start.character } });
      }
      for (const c of (s.children || [])) {
        if (c.kind === vscode.SymbolKind.Method || c.kind === vscode.SymbolKind.Function) {
          const clsId = classIds.get(className)!;
          addFn(`${s.name}.${c.name}`, c.selectionRange ?? c.range, c.range, clsId);
        }
        walk(c, 'class');
      }
    } else if (s.kind === vscode.SymbolKind.Function) {
      const keep = !isTsLike || (parentKind === 'module' && !isInlineTsCallback(doc, s.selectionRange ?? s.range)) || parentKind === 'class';
      if (keep) addFn(s.name, s.selectionRange ?? s.range, s.range, moduleId);
      for (const ch of (s.children || [])) walk(ch, 'func');
      return;
    }
    for (const ch of (s.children || [])) walk(ch, parentKind || 'other');
  };
  symbols.forEach(s => walk(s, 'module'));

  if (!fns.length) return parseFallback(uri, text); // reuse the fallback if LSP sparse

  const lines = text.split(/\r?\n/);
  for (const fn of fns) {
    nodes.push({ id: fn.id, kind: 'func', label: `${fn.name}()`, parent: fn.parent, docked: true, snippet: snippetFrom(lines, fn.start), fsPath: uri.fsPath, range: { line: fn.start, col: fn.col } });
  }

  const bare = (n: string) => (n.includes('.') ? n.split('.').pop() || n : n);
  const nameToIds = new Map<string, string[]>();
  for (const fn of fns) {
    const k = bare(fn.name);
    if (!nameToIds.has(k)) nameToIds.set(k, []);
    nameToIds.get(k)!.push(fn.id);
  }
  const reCache = new Map<string, RegExp>();
  const wcr = (t: string) => new RegExp(String.raw`\b${escapeReg(t)}\s*\(`);
  const bareTokOf = (s: string) => (s.includes('.') ? s.split('.').pop() || s : s);
  const bodyOf = (fn: Fn) => {
    try { return doc.getText(new vscode.Range(new vscode.Position(fn.start, 0), new vscode.Position(fn.end + 1, 0))); }
    catch { return lines.slice(fn.start, fn.end + 1).join('\n'); }
  };

  for (const fn of fns) {
    const body = stripStringsAndComments(bodyOf(fn));
    for (const [calleeToken, ids] of nameToIds) {
      if (ids.includes(fn.id)) continue;
      const bareTok = bareTokOf(calleeToken);
      let re = reCache.get(bareTok);
      if (!re) { re = wcr(bareTok); reCache.set(bareTok, re); }
      if (re.test(body) || (calleeToken !== bareTok && wcr(calleeToken).test(body))) {
        edges.push({ from: fn.id, to: ids[0], type: 'call' });
      }
    }
  }

  const T0 = normalizeContinuations(stripStringsAndComments(text));
  const impPy = /(?:^|\n)\s*(?:from\s+([\w\.]+)\s+import\s+([A-Za-z0-9_\,\s\*\.]+)|import\s+([\w\.]+)(?:\s+as\s+\w+)?)/g;
  const impTs = /(?:^|\n)\s*(?:import\s+(?:[^'"]+)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|export\s+[^;]+?\s+from\s+['"]([^'"]+)['"])/g;

  let m: RegExpExecArray | null;
  while ((m = impPy.exec(T0)) !== null) {
    const target = (m[1] ?? m[3] ?? '').trim();
    if (!target) continue;
    const label = resolveImportLabelByText(fileLabel, target, 'py');
    const to = label ? `mod_${fnv1aHex(label)}` : `mod_${fnv1aHex(target)}`;
    edges.push({ from: moduleId, to, type: 'import' });
  }
  while ((m = impTs.exec(T0)) !== null) {
    const target = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!target) continue;
    const label = resolveImportLabelByText(fileLabel, target, 'ts');
    const to = label ? `mod_${fnv1aHex(label)}` : `mod_${fnv1aHex(target)}`;
    edges.push({ from: moduleId, to, type: 'import' });
  }

  return { nodes, edges };
}

// local import to avoid circular
async function parseFallback(uri: vscode.Uri, text: string) {
  const mod = await import('./FallbackParser');
  return mod.parseFallback(uri, text);
}
