import { Xorshift128Plus } from '../engine/Xorshift128Plus.js';
import type {
  RaftClusterConfig,
  RaftLogEntry,
  RaftNodeState,
  RaftRole,
  RequestVoteArgs,
  RequestVoteResponse,
  AppendEntriesArgs,
  AppendEntriesResponse,
  StateMachineSnapshot,
} from './types.js';
import { DEFAULT_CLUSTER_CONFIG } from './types.js';

const DEFAULT_ELECTION_TIMEOUT = 150;
const DEFAULT_HEARTBEAT_INTERVAL = 10;

/**
 * A single Raft node implementing the consensus state machine.
 * Supports Follower, Candidate, and Leader roles with term management,
 * leader election, log replication, commit advancement, and Figure 8 safety.
 */
export class RaftNode {
  readonly nodeId: number;
  private config: RaftClusterConfig;
  private rng: Xorshift128Plus;
  private clock: number = 0;
  private seq: number = 0;

  // ── Raft persistent state ────────────────────────────────────────
  role: RaftRole = 'follower';
  currentTerm: number = 0;
  votedFor: number | null = null;
  log: RaftLogEntry[] = [];
  commitIndex: number = 0;
  lastApplied: number = 0;

  // ── Leader transient state ───────────────────────────────────────
  nextIndex = new Map<number, number>();
  matchIndex = new Map<number, number>();

  // ── Timing ───────────────────────────────────────────────────────
  private electionTimeout: number = DEFAULT_ELECTION_TIMEOUT;
  private electionTimerExpiry: number = 0;
  private heartbeatInterval: number = DEFAULT_HEARTBEAT_INTERVAL;
  private lastHeartbeatTime: number = 0;

  // ── Vote tracking (transient) ────────────────────────────────────
  private votesReceived = new Set<number>();

  // ── Key-value state machine ──────────────────────────────────────
  private stateMachine: StateMachineSnapshot = {};

  constructor(nodeId: number, config: Partial<RaftClusterConfig> = {}, seed?: number) {
    this.nodeId = nodeId;
    this.config = { ...DEFAULT_CLUSTER_CONFIG, ...config };
    const effectiveSeed = seed !== undefined ? seed : this.config.seed;
    this.rng = new Xorshift128Plus(effectiveSeed + nodeId);
    this.electionTimeout = this.config.baseElectionTimeout + this.rng.nextInt(Math.max(1, this.config.electionTimeoutJitter * 2));
    this.electionTimerExpiry = this.clock + this.electionTimeout;
    this.heartbeatInterval = this.config.heartbeatInterval;
  }

  /** Get the current state snapshot. */
  getState(): RaftNodeState {
    return {
      role: this.role,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      log: [...this.log],
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      nextIndex: new Map(this.nextIndex),
      matchIndex: new Map(this.matchIndex),
      electionTimeout: this.electionTimeout,
      heartbeatInterval: this.heartbeatInterval,
      stateMachine: { ...this.stateMachine },
    };
  }

  /** Get the last log entry's term and index. */
  getLastLogInfo(): { lastLogIndex: number; lastLogTerm: number } {
    const lastEntry = this.log[this.log.length - 1];
    return {
      lastLogIndex: lastEntry ? lastEntry.index : 0,
      lastLogTerm: lastEntry ? lastEntry.term : 0,
    };
  }

  /** Advance the node's clock. */
  advanceClock(newTime: number): void {
    if (newTime < this.clock) {
      throw new Error(`Clock cannot go backward: ${newTime} < ${this.clock}`);
    }
    this.clock = newTime;
  }

  /** Get current clock time. */
  getTime(): number {
    return this.clock;
  }

  // ── Election Timer ────────────────────────────────────────────────

  /** Reset the election timer with a new randomized timeout. */
  resetElectionTimer(): void {
    const jitter = Math.max(1, this.config.electionTimeoutJitter || 0);
    this.electionTimeout = this.config.baseElectionTimeout + this.rng.nextInt(jitter * 2);
    this.electionTimerExpiry = this.clock + this.electionTimeout;
  }

  /** Check if the election timer has expired. */
  isElectionTimedOut(): boolean {
    return this.clock >= this.electionTimerExpiry;
  }

  // ── Role Transitions ──────────────────────────────────────────────

  /** Transition this node to follower role. */
  becomeFollower(term: number): void {
    this.role = 'follower';
    this.currentTerm = term;
    this.votedFor = null;
    this.electionTimerExpiry = this.clock + this.electionTimeout;
  }

  /** Transition this node to candidate role and start an election. */
  startElection(): void {
    this.role = 'candidate';
    this.currentTerm++;
    this.votedFor = this.nodeId;
    this.log.push({
      index: this.log.length + 1,
      term: this.currentTerm,
    });
    this.resetElectionTimer();
    this.votesReceived.clear();
    this.votesReceived.add(this.nodeId); // Vote for self
  }

  /** Transition this node to leader role. */
  becomeLeader(): void {
    this.role = 'leader';
    this.lastHeartbeatTime = this.clock;
    // Initialize leader state
    const lastIndex = this.log.length;
    for (let i = 0; i < this.config.nodeCount; i++) {
      if (i !== this.nodeId) {
        this.nextIndex.set(i, lastIndex + 1);
        this.matchIndex.set(i, 0);
      }
    }
    // Don't clear votes — they remain valid evidence of the election win.
  }

  // ── Client Command Submission (Part 2) ───────────────────────────

  /**
   * Propose a client command on the leader. Appends the entry to the local log.
   * Returns true if the command was accepted, false otherwise.
   */
  propose(command: string): boolean {
    if (this.role !== 'leader') {
      return false;
    }
    const newIndex = this.log.length + 1;
    this.log.push({ index: newIndex, term: this.currentTerm, command });
    // Set nextIndex/matchIndex for the new entry
    for (let i = 0; i < this.config.nodeCount; i++) {
      if (i !== this.nodeId) {
        // nextIndex already points after the last entry; will be sent in next heartbeat
        if (!this.nextIndex.has(i) || this.nextIndex.get(i)! <= newIndex) {
          // Update to point past the new entry once acked
        }
      }
    }
    return true;
  }

  /**
   * Apply committed entries to the state machine (key-value store).
   * Called by the leader after commitIndex advances.
   * Returns list of applied commands.
   */
  applyCommittedEntries(): string[] {
    const applied: string[] = [];
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied - 1];
      if (entry && entry.command) {
        applied.push(entry.command);
        this.applyCommand(entry.command);
      }
    }
    return applied;
  }

  /** Apply a single command to the key-value state machine. */
  applyCommand(command: string): void {
    const parts = command.split(' ');
    if (parts.length === 0) return;
    const action = parts[0];
    if (action === 'set' && parts.length >= 3) {
      const key = parts[1];
      const value = parts.slice(2).join(' ');
      this.stateMachine[key] = value;
    } else if (action === 'del' && parts.length >= 2) {
      const key = parts[1];
      delete this.stateMachine[key];
    }
  }

  /**
   * Advance commitIndex per Figure 8: for the current term, find the highest
   * index replicated on a majority of nodes and commit it.
   */
  advanceCommitIndex(): void {
    if (this.role !== 'leader') return;
    // Find indices replicated on a majority (including self)
    const candidates = this.log.map((_, i) => i + 1); // 1-based indices
    const majority = Math.floor(this.config.nodeCount / 2) + 1;
    let newCommit = this.commitIndex;
    for (const idx of candidates) {
      if (idx <= this.commitIndex) continue;
      const entry = this.log[idx - 1];
      if (!entry || entry.term !== this.currentTerm) continue;
      let replicationCount = 1; // self
      for (let j = 0; j < this.config.nodeCount; j++) {
        if (j === this.nodeId) continue;
        const match = this.matchIndex.get(j) ?? 0;
        if (match >= idx) replicationCount++;
      }
      if (replicationCount >= majority) {
        newCommit = Math.max(newCommit, idx);
      }
    }
    this.commitIndex = newCommit;
  }

  /** Read a key from the state machine. */
  getStateValue(key: string): unknown {
    return this.stateMachine[key];
  }

  /** Get the full state machine snapshot. */
  getStateMachineSnapshot(): StateMachineSnapshot {
    return { ...this.stateMachine };
  }

  // ── Vote Handling ─────────────────────────────────────────────────

  /** Handle an incoming RequestVote RPC. Returns response and whether vote was granted. */
  handleRequestVote(args: RequestVoteArgs): { response: RequestVoteResponse; voteGranted: boolean } {
    // If candidate's term is greater, step down
    if (args.term > this.currentTerm) {
      this.becomeFollower(args.term);
    }

    let voteGranted = false;
    if (args.term >= this.currentTerm) {
      if (
        (this.votedFor === null || this.votedFor === args.candidateId) &&
        this.isLogUpToDate(args.lastLogIndex, args.lastLogTerm)
      ) {
        voteGranted = true;
        this.votedFor = args.candidateId;
        this.resetElectionTimer();
      }
    }

    const response: RequestVoteResponse = {
      term: this.currentTerm,
      voteGranted,
    };

    return { response, voteGranted };
  }

  /** Check if candidate's log is at least as up-to-date as ours. */
  private isLogUpToDate(candidateLastIndex: number, candidateLastTerm: number): boolean {
    const ourLast = this.getLastLogInfo();
    if (candidateLastTerm !== ourLast.lastLogTerm) {
      return candidateLastTerm > ourLast.lastLogTerm;
    }
    return candidateLastIndex >= ourLast.lastLogIndex;
  }

  // ── Heartbeat / AppendEntries ─────────────────────────────────────

  /** Handle an incoming AppendEntries RPC (as follower or candidate). */
  handleAppendEntries(args: AppendEntriesArgs): { response: AppendEntriesResponse; success: boolean } {
    let success = false;
    const response: AppendEntriesResponse = {
      term: this.currentTerm,
      success: false,
    };

    // If leader's term is greater, step down
    if (args.term > this.currentTerm) {
      this.becomeFollower(args.term);
    }

    // Update election timer on valid heartbeat
    if (args.term >= this.currentTerm) {
      this.role = 'follower';
      this.currentTerm = args.term;
      this.votedFor = null;
      this.resetElectionTimer();

      // Check log consistency
      const prevEntry = args.prevLogIndex >= 0 && args.prevLogIndex < this.log.length
        ? this.log[args.prevLogIndex]
        : null;

      const logMatches =
        args.prevLogIndex === -1 ||
        (prevEntry && prevEntry.term === args.prevLogTerm);

      if (logMatches) {
        success = true;

        // Append new entries (with backtracking on conflicts)
        if (args.entries.length > 0) {
          for (const entry of args.entries) {
            const entryIdx = entry.index - 1;
            if (entryIdx < this.log.length) {
              if (this.log[entryIdx].term !== entry.term) {
                // Conflict: delete the conflicting entry and all following
                this.log.splice(entryIdx);
                this.log.push(entry);
              }
            } else {
              this.log.push(entry);
            }
          }
        }

        // Update commit index (Figure 8: only commit from currentTerm)
        if (args.leaderCommit > this.commitIndex) {
          this.commitIndex = Math.min(args.leaderCommit, this.log.length);
        }
      }
    }

    response.success = success;
    return { response, success };
  }

  // ── Vote Tracking ─────────────────────────────────────────────────

  /** Record that we received a vote from another node. */
  recordVoteFrom(voterId: number): void {
    this.votesReceived.add(voterId);
  }

  /** Check if we have majority votes. */
  hasMajorityVotes(): boolean {
    const majority = Math.floor(this.config.nodeCount / 2) + 1;
    return this.votesReceived.size >= majority;
  }

  /** Get count of votes received (excluding self). */
  getVoteCount(): number {
    return this.votesReceived.size - 1;
  }

  /** Get total vote count including self. */
  getTotalVoteCount(): number {
    return this.votesReceived.size;
  }

  /** Get the set of nodes that voted for us. */
  getVotesReceived(): Set<number> {
    return new Set(this.votesReceived);
  }

  // ── Serialization ─────────────────────────────────────────────────

  /** Serialize node state for snapshotting. */
  serialize(): RaftNodeState {
    return this.getState();
  }

  /** Deserialize node state from snapshot. */
  deserialize(state: RaftNodeState): void {
    this.role = state.role;
    this.currentTerm = state.currentTerm;
    this.votedFor = state.votedFor;
    this.log = [...state.log];
    this.commitIndex = state.commitIndex;
    this.lastApplied = state.lastApplied;
    this.nextIndex = new Map(state.nextIndex);
    this.matchIndex = new Map(state.matchIndex);
    this.electionTimeout = state.electionTimeout;
    this.heartbeatInterval = state.heartbeatInterval;
    this.stateMachine = state.stateMachine ?? {};
    this.votesReceived.clear();
    // Restore self-vote if this node was a candidate/leader
    if (state.role === 'candidate' || state.role === 'leader') {
      this.votesReceived.add(this.nodeId);
    }
  }

  /** Get configured election timeout. */
  getElectionTimeout(): number {
    return this.electionTimeout;
  }
}
