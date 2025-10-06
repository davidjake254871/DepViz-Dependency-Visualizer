import * as vscode from 'vscode';
import { decodeUtf8 } from '../utils/fs';

// minimal shim so we don't need @types/node runtime check
declare const Buffer: any;

export class DvDocument implements vscode.CustomDocument {
  static async create(uri: vscode.Uri): Promise<DvDocument> {
    let bytes: Uint8Array;
    try { bytes = await vscode.workspace.fs.readFile(uri); } catch { bytes = new Uint8Array(); }
    const text = bytes && bytes.length ? decodeUtf8(bytes)
      : '{"version":1,"pan":{"x":0,"y":0},"zoom":1,"typeVisibility":{"import":true,"call":true},"data":{"nodes":[],"edges":[]}}';
    return new DvDocument(uri, text);
  }
  private readonly _onDidDispose = new vscode.EventEmitter<void>();
  private readonly _onDidChange = new vscode.EventEmitter<{ label?: string; undo(): void; redo(): void }>();
  public readonly onDidDispose = this._onDidDispose.event;
  public readonly onDidChangeCustomDocument = this._onDidChange.event;
  private _text: string;
  private _savedText: string;
  private constructor(public readonly uri: vscode.Uri, initialText: string) {
    this._text = initialText;
    this._savedText = initialText;
  }
  dispose() { this._onDidDispose.fire(); this._onDidDispose.dispose(); this._onDidChange.dispose(); }
  getText() { return this._text; }
  applyEdit(nextText: string, label = 'Edit graph') {
    const prev = this._text;
    if (prev === nextText) return;
    this._text = nextText;
    this._onDidChange.fire({ label, undo: () => { this._text = prev; }, redo: () => { this._text = nextText; } });
  }
  async save(_token: vscode.CancellationToken): Promise<void> {
    await vscode.workspace.fs.writeFile(this.uri, Buffer.from(this._text, 'utf8'));
    this._savedText = this._text;
  }
  async saveAs(target: vscode.Uri, _token: vscode.CancellationToken): Promise<void> {
    await vscode.workspace.fs.writeFile(target, Buffer.from(this._text, 'utf8'));
    this._savedText = this._text;
  }
  async revert(_token: vscode.CancellationToken): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(this.uri);
    const text = decodeUtf8(bytes);
    const prev = this._text;
    this._text = text;
    this._savedText = text;
    this._onDidChange.fire({ label: 'Revert', undo: () => { this._text = prev; }, redo: () => { this._text = text; } });
  }
  async backup(destination: vscode.Uri, _token: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(destination, Buffer.from(this._text, 'utf8'));
    return { id: destination.toString(), delete: async () => { try { await vscode.workspace.fs.delete(destination); } catch {} } };
  }
}
