import * as vscode from 'vscode';
import { normalizePath } from '../utils/paths';

const MAP: Map<string,string> = new Map();

export const Fingerprints = {
  same(uri: vscode.Uri, fp: string) {
    const key = normalizePath(uri.fsPath);
    const prev = MAP.get(key);
    if (prev === fp) return true;
    MAP.set(key, fp);
    return false;
  },
  evict(fsPath: string) {
    MAP.delete(normalizePath(fsPath));
  },
  clear() { MAP.clear(); }
};
