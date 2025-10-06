import * as vscode from 'vscode';
import { fnv1aHex } from '../utils/hash';
import { stripStringsAndComments, resolveImportLabelByText, snippetFrom, escapeReg } from './shared';

export function parseFallback(uri: vscode.Uri, text: string) {
  const fileLabel = vscode.workspace.asRelativePath(uri, false);
  const moduleLabelKey = fileLabel.replace(/\\/g,'/');
  const moduleId = `mod_${fnv1aHex(moduleLabelKey)}`;

  const nodes: any[] = [{ id: moduleId, kind: 'module', label: fileLabel, fsPath: uri.fsPath, source: text }];
  const edges: any[] = [];

  const lines = text.split(/\r?\n/);
  type Fn = { id: string; name: string; start: number; end: number; col: number; parent?: string };

  const fns: Fn[] = [];
  const pyDef = /^\s*def\s+([a-zA-Z_\d]+)\s*\(/;
  const pyClass = /^\s*class\s+([A-Za-z_\d]+)\s*[:(]/;
  const tsDef = /^\s*(?:export\s+)?function\s+([a-zA-Z_\d]+)\s*\(/;
  const tsVarFn = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_\d]+)\s*=\s*(?:async\s*)?(?:function\s*\(|\([^)]*\)\s*=>)/;

  const classIds = new Map<string,string>();
  const classStack: Array<{ name: string; indent: number; id: string }> = [];

  for (let i=0;i<lines.length;i++){
    const L = lines[i];
    const indent = (L.match(/^\s*/)?.[0]?.length) || 0;
    while (classStack.length && indent <= classStack[classStack.length-1].indent) classStack.pop();

    const cm = pyClass.exec(L);
    if (cm) {
      const clsName = cm[1];
      const clsId = `cls_${fnv1aHex(fileLabel + ':' + clsName)}`;
      classIds.set(clsName, clsId);
      classStack.push({ name: clsName, indent, id: clsId });
      nodes.push({ id: clsId, kind: 'class', label: `class ${clsName}`, parent: moduleId, docked: true,
        snippet: lines.slice(i, Math.min(lines.length, i+20)).join('\n'), fsPath: uri.fsPath, range: { line: i, col: indent } });
      continue;
    }

    const m1 = pyDef.exec(L) || tsDef.exec(L) || tsVarFn.exec(L);
    if (m1) {
      const name = m1[1];
      const id = `fn_${fnv1aHex(fileLabel + ':' + name + ':' + i)}`;
      let parent: string | undefined;
      let labelName = name;
      if (classStack.length) { const top = classStack[classStack.length-1]; parent = top.id; labelName = `${top.name}.${name}`; }
      fns.push({ id, name: labelName, start: i, end: lines.length, col: indent, parent });
    }
  }
  for (let i=0;i<fns.length-1;i++) fns[i].end = fns[i+1].start - 1;

  for (const fn of fns) {
    nodes.push({ id: fn.id, kind: 'func', label: `${fn.name}()`, parent: fn.parent || moduleId, docked: true,
      snippet: snippetFrom(lines, fn.start), fsPath: uri.fsPath, range: { line: fn.start, col: fn.col } });
  }

  const nameToId = new Map<string,string>();
  const callRegex = new Map<string, RegExp>();
  const wcr = (t: string) => new RegExp(String.raw`\b${escapeReg(t)}\s*\(`);
  const bareTokOf = (s: string) => (s.includes('.') ? s.split('.').pop() || s : s);
  for (const fn of fns) {
    nameToId.set(fn.name, fn.id);
    callRegex.set(fn.name, wcr(fn.name));
  }

  for (const fn of fns) {
    const body = stripStringsAndComments(lines.slice(fn.start, fn.end + 1).join('\n'));
    for (const [calleeName, calleeId] of nameToId) {
      if (calleeName === fn.name) continue;
      const full = callRegex.get(calleeName) ?? wcr(calleeName);
      const bare = wcr(bareTokOf(calleeName));
      if (full.test(body) || bare.test(body)) edges.push({ from: fn.id, to: calleeId, type: 'call' });
    }
  }

  const T = stripStringsAndComments(text);
  const impPy = /^(?:from\s+([\w\.]+)\s+import\s+[\w\*,\s\(\)]+|import\s+([\w\.]+)(?:\s+as\s+\w+)?)/gm;
  const impTs = /(?:^|\n)\s*(?:import\s+(?:.+?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g;

  let m: RegExpExecArray | null;
  while ((m = impPy.exec(T)) !== null) {
    const target = (m[1] ?? m[2] ?? '').trim();
    if (!target) continue;
    const label = resolveImportLabelByText(fileLabel, target, 'py');
    const to = label ? `mod_${fnv1aHex(label)}` : `mod_${fnv1aHex(target)}`;
    edges.push({ from: moduleId, to, type: 'import' });
  }
  while ((m = impTs.exec(T)) !== null) {
    const target = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!target) continue;
    const label = resolveImportLabelByText(fileLabel, target, 'ts');
    const to = label ? `mod_${fnv1aHex(label)}` : `mod_${fnv1aHex(target)}`;
    edges.push({ from: moduleId, to, type: 'import' });
  }

  return { nodes, edges };
}
