import * as vscode from 'vscode';

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * Math.random() * chars.length));
  return s;
}

function buildHtml(webview: vscode.Webview, deps: {
  scriptUris: string[];
  styleUri: string;
  dataUri: string;
  codiconUri: string;
  iconDark: string;
  iconLight: string;
  noSample?: boolean;
}) {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} blob:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${n}' ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`
  ].join('; ');

  const dataDecl = deps.noSample ? 'window.DEPVIZ = { DATA_URI: "", NO_SAMPLE: true };' :
                                   `window.DEPVIZ = { DATA_URI: "${deps.dataUri}" };`;

  return `
  <!DOCTYPE html>
  <html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${deps.styleUri}" rel="stylesheet" />
    <link href="${deps.codiconUri}" rel="stylesheet" />
    <title>DepViz</title>
  </head>
  <body>
    <div id="toolbar" role="toolbar" aria-label="DepViz toolbar">
      <img id="themeToggle" title="Toggle theme" width="18" height="18"
           src="${deps.iconLight}" data-icon-dark="${deps.iconDark}" data-icon-light="${deps.iconLight}" />
      <button id="btnHelp" title="Shortcuts (?)">?</button>
    </div>
    <div id="canvasWrapper">
      <svg id="canvas" tabindex="0" aria-label="dependency canvas" role="application"></svg>
    </div>
    <div id="help" hidden>
      <div class="hcard">
        <b>Shortcuts</b>
        <div>Ctrl/Cmd+Shift+A – Arrange by folders</div>
        <div>Ctrl/Cmd+Shift+B – Balanced grid</div>
        <div>Ctrl/Cmd+/ – Toggle help</div>
        <div>Ctrl/Cmd+Shift+S – Clear impact slice</div>
        <div>Drag files/folders to import</div>
        <div>Click legend to toggle edge types</div>
      </div>
    </div>
    <div id="legend"></div>

    <script nonce="${n}">
      ${dataDecl}
      window.vscode = acquireVsCodeApi();
      window.DATA_URI = window.DEPVIZ.DATA_URI;
    </script>

    ${deps.scriptUris.map(u=>`<script nonce="${n}" src="${u}"></script>`).join("\n    ")}
  </body>
  </html>`;
}

export function htmlFor(ctx: vscode.ExtensionContext, webview: vscode.Webview): string {
  const base = ctx.extensionUri;
  const js = (p:string)=> webview.asWebviewUri(vscode.Uri.joinPath(base,'media',p)).toString();
  const css = (p:string)=> webview.asWebviewUri(vscode.Uri.joinPath(base,'media',p)).toString();

  return buildHtml(webview, {
    scriptUris: [js('webview.js'), js('webview-geom.js'), js('webview-interact.js'), js('webview-arrange.js'), js('webview-data.js')],
    styleUri: css('webview.css'),
    dataUri: js('sampleData.json'),
    codiconUri: css('codicon.css'),
    iconDark: js('depviz-dark.svg'),
    iconLight: js('depviz-light.svg')
  });
}

export function htmlForCustom(ctx: vscode.ExtensionContext, webview: vscode.Webview): string {
  const base = ctx.extensionUri;
  const js = (p:string)=> webview.asWebviewUri(vscode.Uri.joinPath(base,'media',p)).toString();
  const css = (p:string)=> webview.asWebviewUri(vscode.Uri.joinPath(base,'media',p)).toString();

  return buildHtml(webview, {
    scriptUris: [js('webview.js'), js('webview-geom.js'), js('webview-interact.js'), js('webview-arrange.js'), js('webview-data.js')],
    styleUri: css('webview.css'),
    dataUri: '',
    codiconUri: css('codicon.css'),
    iconDark: js('depviz-dark.svg'),
    iconLight: js('depviz-light.svg'),
    noSample: true
  });
}
