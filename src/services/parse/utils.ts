// src/services/parse/utils.ts
import type * as vscode from 'vscode';
import { escapeReg } from '../../shared/text';
import { hash } from '../../shared/encoding';

export function normalizeContinuations(src: string): string {
  let s = src.replace(/\\\r?\n/g, ' ');
  s = s.replace(/from\s+[\w\.]+\s+import\s*\(([\s\S]*?)\)/g, (match) => match.replace(/\r?\n/g, ' '));
  return s;
}

export function stripStringsAndComments(src: string): string {
  let s = src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  s = s.replace(/^[ \t]*#.*$/gm, '');
  s = s.replace(/("""|''')[\s\S]*?\1/g, '');
  s = s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '');
  s = s.replace(/`(?:\\.|[^\\`$]|(\$\{[\s\S]*?\}))*`/g, (match) => {
    const parts: string[] = [];
    const re = /\$\{([\s\S]*?)\}/g;
    let k: RegExpExecArray | null;
    while ((k = re.exec(match))) {
      parts.push(k[1]);
    }
    return parts.join(' ');
  });
  return s;
}

export function normalizePosixPath(input: string): string {
  const parts = input.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function resolveImportLabelByText(fromLabel: string, spec: string, lang: 'ts' | 'py'): string | null {
  try {
    const posixFrom = fromLabel.replace(/\\/g, '/');
    const baseDir = posixFrom.includes('/') ? posixFrom.slice(0, posixFrom.lastIndexOf('/')) : '';
    const rel = (p: string) => normalizePosixPath((baseDir ? `${baseDir}/` : '') + p);

    if (lang === 'ts') {
      if (spec.startsWith('.')) {
        const core = rel(spec);
        if (/\.(ts|tsx|js|jsx)$/i.test(core)) {
          return core;
        }
        const candidates = [
          `${core}.ts`, `${core}.tsx`, `${core}.js`, `${core}.jsx`,
          `${core}/index.ts`, `${core}/index.tsx`, `${core}/index.js`, `${core}/index.jsx`
        ];
        return candidates[0];
      }
      if (spec.startsWith('/')) {
        const sansLeading = spec.replace(/^\/+/, '');
        const core = normalizePosixPath(sansLeading);
        return /\.(ts|tsx|js|jsx)$/i.test(core) ? core : `${core}.ts`;
      }
      return null;
    }

    if (spec.startsWith('.')) {
      const up = spec.match(/^\.+/);
      const dots = up ? up[0].length : 0;
      const rest = spec.slice(dots).replace(/^\./, '');
      const pops = Math.max(0, dots - 1);
      let parts = baseDir ? baseDir.split('/') : [];
      parts = parts.slice(0, Math.max(0, parts.length - pops));
      const core = normalizePosixPath(parts.join('/') + (rest ? `/${rest.replace(/\./g, '/')}` : ''));
      const candidates = [`${core}.py`, `${core}/__init__.py`];
      return candidates[0];
    }

    const core = normalizePosixPath(spec.replace(/\./g, '/'));
    const candidates = [`${core}.py`, `${core}/__init__.py`];
    return candidates[0];
  } catch {
    return null;
  }
}

export function makeFuncId(fileLabel: string, name: string, line: number): string {
  return `fn_${hash(`${fileLabel}:${name}:${line}`)}`;
}

export function makeClassId(fileLabel: string, name: string): string {
  return `cls_${hash(`${fileLabel}:${name}`)}`;
}

export function makeModuleId(labelKey: string): string {
  return `mod_${hash(labelKey)}`;
}

export type SymbolFetcher = typeof import('vscode')['commands']['executeCommand'];

