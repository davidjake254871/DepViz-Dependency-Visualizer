import * as vscode from 'vscode';

export class StatusBar {
  private item: vscode.StatusBarItem;
  private totals = { modules: 0, funcs: 0 };

  constructor(ctx: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'depviz.open';
    this.item.text = 'DepViz: $(graph) Ready';
    this.item.tooltip = 'Open DepViz';
    this.item.show();
    ctx.subscriptions.push(this.item);
  }

  bump(artifacts: { nodes: any[] }) {
    const nodes = artifacts.nodes || [];
    this.totals.modules += nodes.filter(n => n.kind === 'module').length;
    this.totals.funcs   += nodes.filter(n => n.kind === 'func').length;
    this.render();
  }

  reset() { this.totals = { modules: 0, funcs: 0 }; this.render(); }

  private render() {
    this.item.text = `DepViz: $(graph) ${this.totals.modules} mod | ${this.totals.funcs} fn`;
    this.item.tooltip = 'Click to reopen DepViz';
  }
}
