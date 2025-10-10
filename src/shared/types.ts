// src/shared/types.ts
export type EdgeType = 'import' | 'call';

export type NodeKind = 'module' | 'class' | 'func';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  fsPath: string;
  parent?: string;
  docked?: boolean;
  source?: string;
  snippet?: string;
  range?: { line: number; col: number };
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface GraphArtifacts {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Totals {
  modules: number;
  funcs: number;
}

