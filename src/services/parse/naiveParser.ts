// src/services/parse/naiveParser.ts
import * as vscode from 'vscode';
import { GraphArtifacts } from '../../shared/types';
import { snippetFrom, escapeReg } from '../../shared/text';
import { hash } from '../../shared/encoding';
import {
  stripStringsAndComments,
  resolveImportLabelByText,
  normalizePosixPath,
  makeModuleId,
  makeClassId,
  makeFuncId
} from './utils';

export function parseNaive(uri: vscode.Uri, text: string): GraphArtifacts {
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

  const lines = text.split(/\r?\n/);

  type Fn = { id: string; name: string; start: number; end: number; col: number; parent?: string };
  const fns: Fn[] = [];
  const pyDef = /^\s*def\s+([a-zA-Z_\d]+)\s*\(/;
  const pyClass = /^\s*class\s+([A-Za-z_\d]+)\s*[:(]/;
  const tsDef = /^\s*(?:export\s+)?function\s+([a-zA-Z_\d]+)\s*\(/;
  const tsVarFn = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_\d]+)\s*=\s*(?:async\s*)?(?:function\s*\(|\([^)]*\)\s*=>)/;

  const classIds = new Map<string, string>();
  const classStack: Array<{ name: string; indent: number; id: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = (line.match(/^\s*/)?.[0]?.length) || 0;

    while (classStack.length && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }

    const classMatch = pyClass.exec(line);
    if (classMatch) {
      const className = classMatch[1];
      const classId = makeClassId(fileLabel, className);
      classIds.set(className, classId);
      classStack.push({ name: className, indent, id: classId });
      nodes.push({
        id: classId,
        kind: 'class',
        label: className,
        parent: moduleId,
        docked: true,
        snippet: lines.slice(i, Math.min(lines.length, i + 20)).join('\n'),
        fsPath: uri.fsPath,
        range: { line: i, col: indent }
      });
      continue;
    }

    const fnMatch = pyDef.exec(line) || tsDef.exec(line) || tsVarFn.exec(line);
    if (fnMatch) {
      const name = fnMatch[1] || fnMatch[2] || fnMatch[3];
      const id = makeFuncId(fileLabel, name, i);
      const col = indent;

      let parent: string | undefined;
      let labelName = name;
      if (classStack.length) {
        const top = classStack[classStack.length - 1];
        parent = top.id;
        labelName = `${top.name}.${name}`;
      }

      fns.push({ id, name: labelName, start: i, end: lines.length, col, parent });
    }
  }

  for (let i = 0; i < fns.length - 1; i++) {
    fns[i].end = fns[i + 1].start - 1;
  }

  for (const fn of fns) {
    nodes.push({
      id: fn.id,
      kind: 'func',
      label: fn.name,
      parent: fn.parent || moduleId,
      docked: true,
      snippet: snippetFrom(lines, fn.start),
      fsPath: uri.fsPath,
      range: { line: fn.start, col: fn.col }
    });
  }

  const nameToId = new Map<string, string>();
  const callRegex = new Map<string, RegExp>();
  const wcr = (token: string) => new RegExp(String.raw`\b${escapeReg(token)}\s*\(`);
  const bareTokOf = (value: string) => (value.includes('.') ? value.split('.').pop() || value : value);

  for (const fn of fns) {
    nameToId.set(fn.name, fn.id);
    callRegex.set(fn.name, wcr(fn.name));
  }

  for (const fn of fns) {
    const body = stripStringsAndComments(lines.slice(fn.start, fn.end + 1).join('\n'));
    for (const [calleeName, calleeId] of nameToId) {
      if (calleeName === fn.name) {
        continue;
      }
      const full = callRegex.get(calleeName) ?? wcr(calleeName);
      const bare = wcr(bareTokOf(calleeName));
      if (full.test(body) || bare.test(body)) {
        edges.push({ from: fn.id, to: calleeId, type: 'call' });
      }
    }
  }

  const stripped = stripStringsAndComments(text);
  const pyImports = /^(?:from\s+([\w\.]+)\s+import\s+[\w\*,\s\(\)]+|import\s+([\w\.]+)(?:\s+as\s+\w+)?)/gm;
  const tsImports = /(?:^|\n)\s*(?:import\s+(?:.+?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match: RegExpExecArray | null;

  while ((match = pyImports.exec(stripped)) !== null) {
    const target = (match[1] ?? match[2] ?? '').trim();
    if (!target) {
      continue;
    }
    const label = resolveImportLabelByText(fileLabel, target, 'py');
    const to = makeModuleId(label ?? target);
    edges.push({ from: moduleId, to, type: 'import' });
  }

  while ((match = tsImports.exec(stripped)) !== null) {
    const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!target) {
      continue;
    }
    const label = resolveImportLabelByText(fileLabel, target, 'ts');
    const to = makeModuleId(label ?? target);
    edges.push({ from: moduleId, to, type: 'import' });
  }

  return { nodes, edges };
}

