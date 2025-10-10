// src/services/import/importService.ts
import * as vscode from 'vscode';
import { RelativePattern } from 'vscode';
import { ParseService } from '../parse/parseService';
import { GraphArtifacts, Totals } from '../../shared/types';
import { normalizePath } from '../../shared/workspace';
import { extOf } from '../../shared/text';
import { dec, hash as hashString } from '../../shared/encoding';

type TotalsUpdater = (artifacts: GraphArtifacts) => void;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '.env',
  'dist', 'out', 'build', '.cache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox'
]);

const SKIP_EXTS = new Set([
  '.d.ts.map',
  '.min.js', '.map', '.lock',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.webp', '.bmp', '.tif', '.tiff', '.apng', '.avif',
  '.pdf', '.zip',
  '.pyc', '.pyo', '.whl', '.so', '.dll',
  '.class'
]);

export class ImportService {
  private readonly fingerprints = new Map<string, string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly parseService: ParseService,
    private readonly onArtifacts: TotalsUpdater,
    private readonly totals: Totals
  ) {}

  async importMany(uris: vscode.Uri[], panel: vscode.WebviewPanel, hardCap: number): Promise<void> {
    if (!uris.length) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration('depviz');
    const include = (cfg.get<string[]>('includeGlobs') ?? ['**/*']).filter(Boolean);
    const exclude = (cfg.get<string[]>('excludeGlobs') ?? ['**/.git/**', '**/node_modules/**', '**/__pycache__/**']).filter(Boolean);
    const maxFiles = Math.max(1, hardCap | 0);

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DepViz: Importing...', cancellable: true },
      async (progress, token) => {
        const files = await this.findFilesFromRoots(uris, include, exclude, maxFiles);
        const capped = files.slice(0, maxFiles);
        let done = 0;
        const batch = 8;
        for (let i = 0; i < capped.length; i += batch) {
          if (token.isCancellationRequested) {
            break;
          }
          await Promise.all(
            capped.slice(i, i + batch).map(u => this.importUri(u, panel, token))
          );
          done = Math.min(capped.length, i + batch);
          progress.report({ message: `${done}/${capped.length}` });
        }
        vscode.window.showInformationMessage(`DepViz: Imported ${done} file(s).`);
      }
    );
  }

  async importUri(uri: vscode.Uri, panel: vscode.WebviewPanel, token?: vscode.CancellationToken): Promise<void> {
    try {
      if (token?.isCancellationRequested) {
        return;
      }

      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        const children = await vscode.workspace.fs.readDirectory(uri);
        for (const [name] of children) {
          if (SKIP_DIRS.has(name)) {
            continue;
          }
          await this.importUri(vscode.Uri.joinPath(uri, name), panel, token);
        }
        return;
      }

      if (stat.size && stat.size > this.currentMaxFileSize()) {
        return;
      }
      if (SKIP_EXTS.has(extOf(uri.path))) {
        return;
      }

      const content = await vscode.workspace.fs.readFile(uri);
      const text = dec(content);

      const fingerprint = hashString(text);
      const key = normalizePath(uri.fsPath);
      const previous = this.fingerprints.get(key);
      if (previous === fingerprint) {
        return;
      }
      this.fingerprints.set(key, fingerprint);

      const artifacts = await this.parseService.parseFile(uri, text);
      panel.webview.postMessage({ type: 'addArtifacts', payload: artifacts });
      this.onArtifacts(artifacts);
    } catch (err) {
      console.error('DepViz importUri failed:', uri.fsPath, (err as any)?.message ?? err);
    }
  }

  resetFingerprints(): void {
    this.fingerprints.clear();
    this.totals.modules = 0;
    this.totals.funcs = 0;
  }

  evictFingerprint(fsPath: string): void {
    this.fingerprints.delete(normalizePath(fsPath));
  }

  private async findFilesFromRoots(
    roots: vscode.Uri[],
    includeGlobs: string[],
    excludeGlobs: string[],
    maxFiles: number
  ): Promise<vscode.Uri[]> {
    const out: vscode.Uri[] = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folderSet = new Set(folders.map(f => f.uri.toString()));

    const files = roots.filter(u => !u.path.endsWith('/') && !u.path.endsWith('\\'));
    out.push(...files);

    const dirs = roots.filter(u => !files.includes(u));
    for (const dir of dirs) {
      let baseFolder = folders.find(f => dir.toString().startsWith(f.uri.toString()));
      if (!baseFolder && folderSet.size === 1) {
        baseFolder = folders[0];
      }

      for (const glob of includeGlobs) {
        const includePattern = baseFolder ? new RelativePattern(baseFolder, glob) : glob;
        const excludePattern = excludeGlobs.length ? `{${excludeGlobs.join(',')}}` : undefined;
        const found = await vscode.workspace.findFiles(includePattern as any, excludePattern, Math.max(1, maxFiles - out.length));
        const scoped = baseFolder
          ? found.filter(u => u.fsPath.toLowerCase().startsWith(dir.fsPath.toLowerCase()))
          : found;

        for (const candidate of scoped) {
          if (out.length >= maxFiles) {
            break;
          }
          out.push(candidate);
        }
        if (out.length >= maxFiles) {
          break;
        }
      }
      if (out.length >= maxFiles) {
        break;
      }
    }
    return out;
  }

  private currentMaxFileSize(): number {
    const mb = vscode.workspace.getConfiguration('depviz').get<number>('maxFileSizeMB') ?? 1.5;
    return Math.max(1, mb) * 1_000_000;
  }
}
