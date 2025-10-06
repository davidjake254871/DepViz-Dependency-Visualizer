import * as vscode from 'vscode';

export function readConfig(){
  const cfg = vscode.workspace.getConfiguration('depviz');
  const maxMB = Math.max(1, (cfg.get<number>('maxFileSizeMB') ?? 1.5));
  return {
    maxFiles: Math.max(1, (cfg.get<number>('maxFiles') ?? 2000)),
    include: (cfg.get<string[]>('includeGlobs') ?? ['**/*']).filter(Boolean),
    exclude: (cfg.get<string[]>('excludeGlobs') ?? ['**/.git/**','**/node_modules/**','**/__pycache__/**']).filter(Boolean),
    maxBytes: maxMB * 1_000_000
  };
}
