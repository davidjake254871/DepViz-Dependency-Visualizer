import * as vscode from 'vscode';

export function normalizePath(p: string) { return p.replace(/\\/g, '/').toLowerCase(); }
export function normalizePosixPath(input: string): string {
  const parts = input.replace(/\\/g,'/').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

export function isInWorkspace(uri: vscode.Uri): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const filePath = normalizePath(uri.fsPath);
  return folders.some(f => {
    const base = normalizePath(f.uri.fsPath).replace(/\/+$/, '');
    const withSlash = base.endsWith('/') ? base : base + '/';
    return filePath === base || filePath.startsWith(withSlash);
  });
}

export function toSafeFileUri(input: string): vscode.Uri {
  const looksLikeUri = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input);
  if (looksLikeUri) {
    const u = vscode.Uri.parse(input);
    if (u.scheme !== 'file') throw new Error('Non-file scheme rejected');
    return u;
  }
  return vscode.Uri.file(input);
}
