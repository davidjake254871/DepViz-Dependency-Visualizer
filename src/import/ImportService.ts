import * as vscode from 'vscode';
import { Fingerprints } from '../state/Fingerprints';
import { parseWithLsp } from '../parse/LspParser';
import { parseFallback } from '../parse/FallbackParser';
import { extOf, decodeUtf8 } from '../utils/fs';
import { readConfig } from '../utils/config';
import { StatusBar } from '../ui/StatusBar';
import { SKIP_DIRS, SKIP_EXTS } from '../constants';
import { toSafeFileUri } from '../utils/paths';
import { fnv1aHex } from '../utils/hash';

export class ImportService {
  constructor(private ctx: vscode.ExtensionContext, private status: StatusBar) {}

  async pickAndImport(panel: vscode.WebviewPanel, uri?: vscode.Uri) {
    const cfg = readConfig();
    const picked = uri ? [uri] : (await vscode.window.showOpenDialog({
      canSelectMany:true, canSelectFiles:true, canSelectFolders:true, openLabel:'Import to DepViz'
    })) || [];
    if (!picked.length) return;

    await vscode.window.withProgress(
      { location:vscode.ProgressLocation.Notification, title:'DepViz: Importing...', cancellable:true },
      async (progress, token) => {
        const files = await this.findFilesFromRoots(picked, cfg.include, cfg.exclude, cfg.maxFiles);
        let done = 0;
        const batch = 8;
        for (let i=0;i<files.length;i+=batch) {
          if (token.isCancellationRequested) break;
          await Promise.all(files.slice(i,i+batch).map(u=>this.importUri(u, panel, token)));
          done = Math.min(files.length, i+batch);
          progress.report({ message: `${done}/${files.length}` });
        }
        vscode.window.showInformationMessage(`DepViz: Imported ${done} file(s).`);
      }
    );
  }

  async importDropped(panel: vscode.WebviewPanel, items: string[]) {
    const uris: vscode.Uri[] = [];
    for (const raw of items) { try { uris.push(toSafeFileUri(raw)); } catch {} }
    if (!uris.length) return;
    await this.pickAndImport(panel, uris[0]);
  }

  async importUri(uri: vscode.Uri, panel: vscode.WebviewPanel, token?: vscode.CancellationToken) {
    if (token?.isCancellationRequested) return;
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      const children = await vscode.workspace.fs.readDirectory(uri);
      for (const [name] of children) {
        if (SKIP_DIRS.has(name)) continue;
        await this.importUri(vscode.Uri.joinPath(uri, name), panel, token);
      }
      return;
    }
    const cfg = readConfig();
    if (stat.size && stat.size > cfg.maxBytes) return;
    if (SKIP_EXTS.has(extOf(uri.path))) return;

    const content = await vscode.workspace.fs.readFile(uri);
    const text = decodeUtf8(content);
    const fp = fnv1aHex(text);
    if (Fingerprints.same(uri, fp)) return;

    const artifacts = await parseWithLsp(uri, text).catch(()=>parseFallback(uri, text));
    panel.webview.postMessage({ type: 'addArtifacts', payload: artifacts });
    this.status.bump(artifacts);
  }

  private async findFilesFromRoots(roots: vscode.Uri[], include: string[], exclude: string[], maxFiles: number): Promise<vscode.Uri[]> {
    const out: vscode.Uri[] = [];
    const files = roots.filter(u => !u.path.endsWith('/') && !u.path.endsWith('\\'));
    out.push(...files);

    const dirs = roots.filter(u => !files.includes(u));
    for (const d of dirs) {
      for (const g of include) {
        const excl = exclude.length ? `{${exclude.join(',')}}` : undefined;
        const found = await vscode.workspace.findFiles(g as any, excl, Math.max(1, maxFiles - out.length));
        const scoped = found.filter(u => u.fsPath.toLowerCase().startsWith(d.fsPath.toLowerCase()));
        for (const u of scoped) { if (out.length >= maxFiles) break; out.push(u); }
        if (out.length >= maxFiles) break;
      }
      if (out.length >= maxFiles) break;
    }
    return out.slice(0, maxFiles);
  }
}
