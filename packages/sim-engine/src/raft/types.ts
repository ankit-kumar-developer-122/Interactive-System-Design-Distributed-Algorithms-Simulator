/**
 * Raft consensus types and interfaces — Part 2 extension.
 */

export type RaftRole = 'follower' | 'candidate' | 'leader';

export interface RaftLogEntry {
  index: number;
  term: number;
  command?: string;
}

export interface RequestVoteArgs {
  term: number;
  candidateId: number;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResponse {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesArgs {
  term: number;
  leaderId: number;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: RaftLogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
}

export interface StateMachineSnapshot {
  [key: string]: unknown;
}

export interface RaftNodeState {
  role: RaftRole;
  currentTerm: number;
  votedFor: number | null;
  log: RaftLogEntry[];
  commitIndex: number;
  lastApplied: number;
  nextIndex: Map<number, number>;
  matchIndex: Map<number, number>;
  electionTimeout: number;
  heartbeatInterval: number;
  stateMachine: StateMachineSnapshot;
}

export interface RaftClusterConfig {
  /** Number of nodes in the cluster */
  nodeCount: number;
  /** Base election timeout in virtual time units */
  baseElectionTimeout: number;
  /** Election timeout jitter range */
  electionTimeoutJitter: number;
  /** Heartbeat interval */
  heartbeatInterval: number;
  /** Network base latency */
  networkLatency: number;
  /** Network jitter */
  networkJitter: number;
  /** Random seed for determinism */
  seed: number;
}

export const DEFAULT_CLUSTER_CONFIG: RaftClusterConfig = {
  nodeCount: 3,
  baseElectionTimeout: 150,
  electionTimeoutJitter: 50,
  heartbeatInterval: 10,
  networkLatency: 10,
  networkJitter: 5,
  seed: 42,
};
