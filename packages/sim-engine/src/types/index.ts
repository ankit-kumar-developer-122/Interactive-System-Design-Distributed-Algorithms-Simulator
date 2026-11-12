export interface Event {
  type: string;
  nodeId: number;
  time: number;
  seq: number;
  data?: Record<string, unknown>;
}

export type NodeState = Record<string, unknown>;

export interface Snapshot {
  clock: number;
  events: Event[];
  nodes: Map<number, NodeState>;
  rngState: Uint32Array;
  seq: number;
  tickCount: number;
}

export type PacingMode = 'step' | 'fast' | 'realtime';

export interface SimulationParams {
  seed: number;
  nodeCount: number;
  pacingMode?: PacingMode;
  tickMs?: number;
}
