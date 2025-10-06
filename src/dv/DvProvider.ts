import * as vscode from 'vscode';
import { DvDocument } from './DvDocument';
import { htmlForCustom } from '../panel/html';
import { decodeUtf8 } from '../utils/fs';
import { PanelHost } from '../panel/PanelHost';

export class DvProvider implements vscode.CustomEditorProvider<DvDocument> {
  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<DvDocument>>();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  private readonly _docSubs = new WeakMap<DvDocument, vscode.Disposable>();

  constructor(private ctx: vscode.ExtensionContext, private host: PanelHost) {}

  async openCustomDocument(uri: vscode.Uri): Promise<DvDocument> {
    const doc = await DvDocument.create(uri);
    const sub = doc.onDidChangeCustomDocument(edit => this._onDidChangeCustomDocument.fire({ document: doc, ...edit }));
    this._docSubs.set(doc, sub);
    return doc;
  }

  async saveCustomDocument(document: DvDocument, token: vscode.CancellationToken): Promise<void> { return document.save(token); }
  async saveCustomDocumentAs(document: DvDocument, targetResource: vscode.Uri, token: vscode.CancellationToken): Promise<void> { return document.saveAs(targetResource, token); }
  async revertCustomDocument(document: DvDocument, token: vscode.CancellationToken): Promise<void> { return document.revert(token); }
  async backupCustomDocument(document: DvDocument, context: vscode.CustomDocumentBackupContext, token: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> { return document.backup(context.destination, token); }

  async resolveCustomEditor(document: DvDocument, panel: vscode.WebviewPanel) {
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    panel.webview.html = htmlForCustom(this.ctx, panel.webview);
    try { panel.webview.postMessage({ type: 'loadSnapshot', payload: JSON.parse(document.getText()) }); }
    catch (e:any) { if (e?.message) vscode.window.showErrorMessage(`DepViz: invalid .dv (${e.message})`); }

    panel.webview.onDidReceiveMessage(async (message:any) => {
      try {
        switch (message.type) {
          case 'edit': {
            const text = JSON.stringify(message.payload ?? {}, null, 2);
            document.applyEdit(text, message.label || 'Graph change');
            break;
          }
          case 'saveSnapshot': {
            const snap = message.payload || {};
            const text = JSON.stringify(snap, null, 2);
            document.applyEdit(text, 'Save graph');
            await document.save(new vscode.CancellationTokenSource().token);
            vscode.window.setStatusBarMessage('DepViz: Snapshot saved', 2000);
            break;
          }
          case 'requestImportJson': {
            const picked = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, filters: { 'JSON': ['json'] } });
            if (!picked?.length) break;
            const content = await vscode.workspace.fs.readFile(picked[0]);
            const text = decodeUtf8(content);
            panel.webview.postMessage({ type: 'addArtifacts', payload: JSON.parse(text) });
            break;
          }
          case 'requestImportSnapshot': {
            const picked = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, filters: { 'DepViz Graph': ['dv','json'] } });
            if (!picked?.length) break;
            const content = await vscode.workspace.fs.readFile(picked[0]);
            panel.webview.postMessage({ type: 'loadSnapshot', payload: JSON.parse(decodeUtf8(content)) });
            vscode.window.showInformationMessage(`DepViz: Loaded snapshot ${picked[0].fsPath}`);
            break;
          }
          default:
            // For everything else, let the main panel host handle equivalently.
            await this.host.forwardFromCustomEditor(message);
        }
      } catch (e:any) {
        vscode.window.showErrorMessage(`DepViz: ${e?.message||e}`);
      }
    });
    panel.onDidDispose(() => { this._docSubs.get(document)?.dispose(); });
  }
}
