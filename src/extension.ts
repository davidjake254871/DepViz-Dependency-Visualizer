// src/extension.ts
import * as vscode from 'vscode';
import { PanelManager } from './services/panel/panelManager';
import { DepvizDvProvider } from './document/dvProvider';
import { isInWorkspace } from './shared/workspace';

let panelManager: PanelManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  panelManager = new PanelManager(context);

  const openCmd = vscode.commands.registerCommand('depviz.open', () => {
    panelManager?.openPanel();
  });

  const importCmd = vscode.commands.registerCommand('depviz.import', async (uri?: vscode.Uri) => {
    if (!panelManager) {
      return;
    }
    const panel = panelManager.openPanel();
    const importService = panelManager.getImportService();
    const cfg = vscode.workspace.getConfiguration('depviz');
    const maxFiles = cfg.get<number>('maxFiles') ?? 2000;

    if (!uri) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: true,
        openLabel: 'Import to DepViz'
      });
      if (!picked) {
        return;
      }
      await importService.importMany(picked, panel, maxFiles);
    } else {
      await importService.importMany([uri], panel, maxFiles);
    }
  });

  const provider = new DepvizDvProvider({
    context,
    importService: panelManager.getImportService(),
    totals: panelManager.getTotals(),
    updateStatusBar: panelManager.getStatusUpdater(),
    gotoSymbol: panelManager.getGotoSymbol()
  });

  const customEditor = vscode.window.registerCustomEditorProvider('depviz.graph', provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true
  });

  const onSave = vscode.workspace.onDidSaveTextDocument(async doc => {
    if (!panelManager) {
      return;
    }
    const panel = panelManager.getActivePanel();
    if (!panel) {
      return;
    }
    if (!isInWorkspace(doc.uri)) {
      return;
    }
    await panelManager.getImportService().importUri(doc.uri, panel);
  });

  context.subscriptions.push(
    panelManager,
    openCmd,
    importCmd,
    customEditor,
    onSave
  );
}

export function deactivate() {
  panelManager?.dispose();
  panelManager = undefined;
}

