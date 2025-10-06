import * as vscode from 'vscode';
import { htmlFor } from './html';
import { ImportService } from '../import/ImportService';
import { StatusBar } from '../ui/StatusBar';
import { Fingerprints } from '../state/Fingerprints';
import { gotoSymbol } from '../symbols/Navigate';
import { decodeUtf8 } from '../utils/fs';
import { isInWorkspace } from '../utils/paths';

export class PanelHost {
  private panel?: vscode.WebviewPanel;
  private readonly imports: ImportService;

  constructor(private ctx: vscode.ExtensionContext, private status: StatusBar) {
    this.imports = new ImportService(ctx, this.status);
  }

  isOpen() { return !!this.panel; }

  open(): vscode.WebviewPanel {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside); return this.panel; }
    this.panel = vscode.window.createWebviewPanel('depviz','DepViz',vscode.ViewColumn.Beside,{ enableScripts:true, retainContextWhenHidden:true });
    this.panel.onDidDispose(() => { this.panel = undefined; });

    Fingerprints.clear(); this.status.reset();

    const wv = this.panel.webview;
    wv.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    wv.html = htmlFor(this.ctx, wv);

    wv.onDidReceiveMessage((message:any) => this.onMessage(message).catch(e => vscode.window.showErrorMessage(String(e))));

    vscode.window.showInformationMessage('DepViz opened. Import files to see something.','Import...','Load Sample')
      .then(async pick => {
        if (pick === 'Import...') { vscode.commands.executeCommand('depviz.import'); }
        if (pick === 'Load Sample') { wv.postMessage({ type: 'requestSample' }); }
      });

    return this.panel;
  }

  async import(uri?: vscode.Uri) {
    const p = this.open();
    await this.imports.pickAndImport(p, uri);
  }

  async refreshOnSave(uri: vscode.Uri) {
    if (!this.panel) return;
    await this.imports.importUri(uri, this.panel);
  }

  async forwardFromCustomEditor(message:any) { return this.onMessage(message); }

  private async onMessage(message:any) {
    if (!this.panel) return;
    const panel = this.panel;
    switch (message.type) {
      case 'requestSample': {
        try {
          const sampleUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'sampleData.json');
          const stat = await vscode.workspace.fs.stat(sampleUri);
          if (stat) {
            const sample = await vscode.workspace.fs.readFile(sampleUri);
            panel.webview.postMessage({ type: 'sampleData', payload: JSON.parse(decodeUtf8(sample)) });
          }
        } catch {}
        break;
      }
      case 'openFile': {
        const fsPath = String(message.fsPath ?? '');
        const u = vscode.Uri.file(fsPath);
        if (u.scheme !== 'file') throw new Error('Only file:// URIs allowed');
        if (!isInWorkspace(u)) throw new Error('Path not inside workspace');
        const doc = await vscode.workspace.openTextDocument(u);
        await vscode.window.showTextDocument(doc, { preview: false });
        break;
      }
      case 'openAt': {
        const fsPath = String(message.fsPath ?? '');
        const line = Math.max(0, Number(message.line ?? 0)|0);
        const col = Math.max(0, Number(message.col ?? 0)|0);
        const view = String(message.view || '').toLowerCase();
        const u = vscode.Uri.file(fsPath);
        if (u.scheme !== 'file') throw new Error('Only file:// URIs allowed');
        if (!isInWorkspace(u)) throw new Error('Path not inside workspace');
        const doc = await vscode.workspace.openTextDocument(u);
        const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: view==='beside' ? vscode.ViewColumn.Beside : undefined });
        const pos = new vscode.Position(Math.min(line, doc.lineCount-1), col);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        break;
      }
      case 'exportData': {
        const kind = String(message.kind || 'json');
        const suggestedName = String(message.suggestedName || `depviz-${Date.now()}.${kind}`);
        const blobBase64 = String(message.base64 || '');
        const filters: Record<string, string[]> =
          kind==='svg' ? { 'SVG': ['svg'] } :
          kind==='png' ? { 'PNG Image': ['png'] } :
          kind==='dv'  ? { 'DepViz Graph': ['dv','json'] } :
                         { 'JSON': ['json'] };
        const uri = await vscode.window.showSaveDialog({ filters, defaultUri: vscode.Uri.file(suggestedName) });
        if (!uri) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bytes = (globalThis as any).Buffer.from(blobBase64, 'base64');
        await vscode.workspace.fs.writeFile(uri, bytes);
        const label = kind==='dv' ? 'DV' : kind.toUpperCase();
        vscode.window.showInformationMessage(`DepViz: Exported ${label} to ${uri.fsPath}`);
        break;
      }
      case 'droppedUris': {
        const items: string[] = Array.isArray(message.items) ? message.items : [];
        await this.imports.importDropped(panel, items);
        break;
      }
      case 'clearCanvas': { Fingerprints.clear(); this.status.reset(); break; }
      case 'evictFingerprint': { const p = String(message.fsPath || ''); if (p) Fingerprints.evict(p); break; }
      case 'impactSummary': {
        const p = message.payload || {};
        const dir = p.dir === 'in' ? 'inbound' : 'outbound';
        const counts = p.counts || { modules:0, classes:0, funcs:0, edges:0 };
        const msg = `Impact slice (${dir}): ${counts.modules} files, ${counts.classes} classes, ${counts.funcs} funcs, ${counts.edges} edges.`;
        const pick = await vscode.window.showInformationMessage(msg, 'Copy files');
        if (pick === 'Copy files') {
          const list = (p.files || []).join('\n');
          await vscode.env.clipboard.writeText(list);
          vscode.window.showInformationMessage(`Copied ${(p.files || []).length} file path(s).`);
        }
        break;
      }
      case 'gotoDef': {
        const t = message.target || {};
        const name = String(t.name || '');
        const file = t.file ? String(t.file) : undefined;
        const view = String(message.view || '').toLowerCase();
        await gotoSymbol({ file, name }, /*peek*/ false, view==='beside');
        break;
      }
      case 'peekRefs': {
        const t = message.target || {};
        const name = String(t.name || '');
        const file = t.file ? String(t.file) : undefined;
        const view = String(message.view || '').toLowerCase();
        await gotoSymbol({ file, name }, /*peek*/ true, view==='beside');
        break;
      }
    }
  }
}
