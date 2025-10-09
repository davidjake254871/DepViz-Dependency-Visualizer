// src/services/parse/parseService.ts
import * as vscode from 'vscode';
import { GraphArtifacts } from '../../shared/types';
import { parseWithLsp } from './lspParser';
import { parseNaive } from './naiveParser';

export class ParseService {
  async parseFile(uri: vscode.Uri, text: string): Promise<GraphArtifacts> {
    const lsp = await parseWithLsp(uri, text);
    if (lsp) {
      return lsp;
    }
    return parseNaive(uri, text);
  }
}

