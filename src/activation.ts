import * as vscode from 'vscode';
import { PanelHost } from './panel/PanelHost';
import { DvProvider } from './dv/DvProvider';
import { StatusBar } from './ui/StatusBar';

export function activate(ctx: vscode.ExtensionContext) {
  const status = new StatusBar(ctx);
  const panel = new PanelHost(ctx, status);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('depviz.open', () => panel.open()),
    vscode.commands.registerCommand('depviz.import', (uri?: vscode.Uri) => panel.import(uri)),
    vscode.window.registerCustomEditorProvider('depviz.graph', new DvProvider(ctx, panel), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true
    })
  );

  const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    if (!panel.isOpen()) return;
    await panel.refreshOnSave(doc.uri);
  });
  ctx.subscriptions.push(onSave);
}

export function deactivate() {}
