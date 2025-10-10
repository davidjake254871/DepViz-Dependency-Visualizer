// src/shared/workspace.ts
import * as vscode from 'vscode';

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isInWorkspace(uri: vscode.Uri): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const filePath = normalizePath(uri.fsPath);
  return folders.some(folder => {
    const base = normalizePath(folder.uri.fsPath).replace(/\/+$/, '');
    const withSlash = base.endsWith('/') ? base : base + '/';
    return filePath === base || filePath.startsWith(withSlash);
  });
}

export function toSafeFileUri(input: string): vscode.Uri {
  const looksLikeUri = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input);
  if (looksLikeUri) {
    const uri = vscode.Uri.parse(input);
    if (uri.scheme !== 'file') {
      throw new Error('Non-file scheme rejected');
    }
    return uri;
  }
  return vscode.Uri.file(input);
}

