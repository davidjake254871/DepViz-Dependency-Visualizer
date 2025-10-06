import { normalizePosixPath } from '../utils/paths';

export function normalizeContinuations(src: string): string {
  let s = src.replace(/\\\r?\n/g, ' ');
  s = s.replace(/from\s+[\w\.]+\s+import\s*\(([\s\S]*?)\)/g, (m) => m.replace(/\r?\n/g, ' '));
  return s;
}

export function stripStringsAndComments(src: string): string {
  let s = src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  s = s.replace(/^[ \t]*#.*$/gm, '');
  s = s.replace(/("""|''')[\s\S]*?\1/g, '');
  s = s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '');
  s = s.replace(/`(?:\\.|[^\\`$]|(\$\{[\s\S]*?\}))*`/g, (m) => {
    const parts: string[] = [];
    const re = /\$\{([\s\S]*?)\}/g;
    let k: RegExpExecArray | null;
    while ((k = re.exec(m))) parts.push(k[1]);
    return parts.join(' ');
  });
  return s;
}

export function resolveImportLabelByText(fromLabel: string, spec: string, lang: 'ts'|'py'): string | null {
  try {
    const posixFrom = fromLabel.replace(/\\/g,'/');
    const baseDir = posixFrom.includes('/') ? posixFrom.slice(0, posixFrom.lastIndexOf('/')) : '';
    const rel = (p: string) => normalizePosixPath((baseDir ? baseDir + '/' : '') + p);
    if (lang === 'ts') {
      if (spec.startsWith('.')) {
        const core = rel(spec);
        if (/\.(ts|tsx|js|jsx)$/i.test(core)) return core;
        const cands = [core + '.ts', core + '.tsx', core + '.js', core + '.jsx', core + '/index.ts', core + '/index.tsx', core + '/index.js', core + '/index.jsx'];
        return cands[0];
      }
      if (spec.startsWith('/')) {
        const s = spec.replace(/^\/+/, '');
        const core = normalizePosixPath(s);
        return /\.(ts|tsx|js|jsx)$/i.test(core) ? core : (core + '.ts');
      }
      return null;
    } else {
      if (spec.startsWith('.')) {
        const up = spec.match(/^\.+/); const dots = up ? up[0].length : 0;
        const rest = spec.slice(dots).replace(/^\./,'');
        const pops = Math.max(0, dots - 1);
        let parts = baseDir ? baseDir.split('/') : [];
        parts = parts.slice(0, Math.max(0, parts.length - pops));
        const core = normalizePosixPath(parts.join('/') + (rest ? ('/' + rest.replace(/\./g,'/')) : ''));
        const cands = [core + '.py', core + '/__init__.py'];
        return cands[0];
      }
      const core = normalizePosixPath(spec.replace(/\./g, '/'));
      const cands = [core + '.py', core + '/__init__.py'];
      return cands[0];
    }
  } catch {}
  return null;
}

export function snippetFrom(lines: string[], start: number) {
  const end = Math.min(lines.length, start + 20);
  return lines.slice(start, end).join('\n');
}

export function escapeReg(s: string){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
