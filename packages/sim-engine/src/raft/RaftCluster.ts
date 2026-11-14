import { NetworkLink } from '../network/NetworkLink.js';
import { createPacket } from '../network/Packet.js';
import type { RaftClusterConfig } from './types.js';
import { RaftNode } from './RaftNode.js';
import { DEFAULT_CLUSTER_CONFIG } from './types.js';

/**
 * A cluster of Raft nodes connected via network links.
 * Manages the network topology, log replication, commit advancement,
 * and provides methods to simulate network partitions and communication.
 */
export class RaftCluster {
  readonly nodes: RaftNode[];
  readonly config: RaftClusterConfig;
  private links: Map<string, NetworkLink> = new Map();
  private clock: number = 0;

  constructor(config: Partial<RaftClusterConfig> = {}) {
    this.config = { ...DEFAULT_CLUSTER_CONFIG, ...config };
    this.nodes = [];

    for (let i = 0; i < this.config.nodeCount; i++) {
      const node = new RaftNode(i, this.config);
      this.nodes.push(node);
    }

    // Wire up all-to-all network links
    this.setupLinks();
  }

  /** Get current cluster time. */
  getTime(): number {
    return this.clock;
  }

  /** Get a network link between two nodes. */
  getLink(from: number, to: number): NetworkLink | undefined {
    return this.links.get(`${from}-${to}`);
  }

  /** Set partition between two nodes (bidirectional). */
  setPartition(nodeA: number, nodeB: number, partitioned: boolean): void {
    const linkAB = this.links.get(`${nodeA}-${nodeB}`);
    const linkBA = this.links.get(`${nodeB}-${nodeA}`);
    if (linkAB) linkAB.setPartitioned(partitioned);
    if (linkBA) linkBA.setPartitioned(partitioned);
  }

  /** Check if two nodes can communicate. */
  isPartitioned(nodeA: number, nodeB: number): boolean {
    const linkAB = this.links.get(`${nodeA}-${nodeB}`);
    const linkBA = this.links.get(`${nodeB}-${nodeA}`);
    return (linkAB?.isPartitioned() || false) && (linkBA?.isPartitioned() || false);
  }

  /** Get all nodes in the cluster. */
  getAllNodes(): RaftNode[] {
    return [...this.nodes];
  }

  /** Get a node by ID. */
  getNode(nodeId: number): RaftNode | undefined {
    return this.nodes[nodeId];
  }

  /** Get the leader node, or undefined if no leader. */
  getLeader(): RaftNode | undefined {
    return this.nodes.find((n) => n.role === 'leader');
  }

  /** Advance the cluster clock and process events. */
  advanceClock(time: number): void {
    for (const node of this.nodes) {
      node.advanceClock(time);
    }
    this.clock = time;
  }

  /** Send a RequestVote RPC from candidate to voter. Returns response. */
  sendVoteRequest(candidateId: number, voterId: number): { term: number; voteGranted: boolean } {
    const candidate = this.nodes[candidateId];
    const voter = this.nodes[voterId];

    if (!candidate || !voter) {
      throw new Error(`Invalid node IDs: candidate=${candidateId}, voter=${voterId}`);
    }

    const link = this.links.get(`${candidateId}-${voterId}`);
    if (!link || link.isPartitioned()) {
      return { term: candidate.currentTerm, voteGranted: false };
    }

    const lastLog = voter.getLastLogInfo();
    const packet = createPacket(
      `vote_${candidateId}_to_${voterId}_${this.clock}`,
      candidateId,
      voterId,
      {
        type: 'request_vote',
        args: {
          term: candidate.currentTerm,
          candidateId,
          lastLogIndex: lastLog.lastLogIndex,
          lastLogTerm: lastLog.lastLogTerm,
        },
      },
      this.clock
    );

    link.send(packet, this.clock);

    const { response, voteGranted } = voter.handleRequestVote({
      term: candidate.currentTerm,
      candidateId,
      lastLogIndex: lastLog.lastLogIndex,
      lastLogTerm: lastLog.lastLogTerm,
    });

    if (voteGranted) {
      candidate.recordVoteFrom(voterId);
    }

    return response;
  }

  /**
   * Send AppendEntries RPC from leader to follower.
   * Returns response and updates leader's nextIndex/matchIndex.
   */
  sendAppendEntries(leaderId: number, followerId: number): { term: number; success: boolean } {
    const leader = this.nodes[leaderId];
    const follower = this.nodes[followerId];

    if (!leader || !follower) {
      throw new Error(`Invalid node IDs: leader=${leaderId}, follower=${followerId}`);
    }

    const link = this.links.get(`${leaderId}-${followerId}`);
    if (!link || link.isPartitioned()) {
      return { term: leader.currentTerm, success: false };
    }

    // Calculate what to send based on leader's nextIndex for this follower
    const nextIdx = leader.nextIndex.get(followerId) ?? leader.log.length;
    // Derive prevLogIndex/Term from the LEADER's log at the boundary.
    // NextIdx is 1-based (points at the first un-replicated entry).
    // prevLogIndex = nextIdx - 1 points to the last entry the leader assumes
    // the follower already has. prevLogTerm comes from the leader's log.
    const prevLogIndex = nextIdx > 1 ? nextIdx - 1 : -1;
    const prevLogTerm = prevLogIndex >= 0 && prevLogIndex < leader.log.length
      ? leader.log[prevLogIndex].term
      : 0;
    const entries = leader.log.slice(Math.max(0, nextIdx - 1));

    const packet = createPacket(
      `ae_${leaderId}_to_${followerId}_${this.clock}`,
      leaderId,
      followerId,
      {
        type: 'append_entries',
        args: {
          term: leader.currentTerm,
          leaderId,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: leader.commitIndex,
        },
      },
      this.clock
    );

    link.send(packet, this.clock);

    const { response, success } = follower.handleAppendEntries({
      term: leader.currentTerm,
      leaderId,
      prevLogIndex,
      prevLogTerm,
      entries,
      leaderCommit: leader.commitIndex,
    });

    // Update leader's nextIndex and matchIndex based on response
    if (success) {
      // Move nextIndex past all replicated entries
      const firstSentIndex = entries.length > 0 ? entries[0].index : nextIdx;
      const lastReplicatedIndex = firstSentIndex + entries.length - 1;
      leader.nextIndex.set(followerId, lastReplicatedIndex + 1);
      leader.matchIndex.set(followerId, lastReplicatedIndex);

      // Advance commitIndex (Figure 8 safety)
      leader.advanceCommitIndex();
    } else {
      // Decrement nextIndex on failure to retry
      const currentNext = leader.nextIndex.get(followerId) ?? nextIdx;
      leader.nextIndex.set(followerId, Math.max(1, currentNext - 1));
    }

    return response;
  }

  /**
   * Run election round: candidate requests votes from all other nodes.
   */
  runElection(candidateId: number): { won: boolean; term: number } {
    const candidate = this.nodes[candidateId];
    if (!candidate) {
      throw new Error(`Invalid candidate ID: ${candidateId}`);
    }

    candidate.startElection();

    let won = false;
    for (let i = 0; i < this.config.nodeCount; i++) {
      if (i === candidateId) continue;

      const result = this.sendVoteRequest(candidateId, i);
      if (result.voteGranted) {
        if (candidate.hasMajorityVotes()) {
          won = true;
          candidate.becomeLeader();
          break;
        }
      }
    }

    return { won, term: candidate.currentTerm };
  }

  /**
   * Run heartbeat round: leader sends heartbeats to all followers and
   * attempts to replicate any uncommitted entries.
   */
  runHeartbeats(leaderId: number): void {
    const leader = this.nodes[leaderId];
    if (!leader || leader.role !== 'leader') {
      return;
    }

    for (let i = 0; i < this.config.nodeCount; i++) {
      if (i === leaderId) continue;
      this.sendAppendEntries(leaderId, i);
    }

    // Apply newly committed entries to the leader's state machine
    leader.applyCommittedEntries();
  }

  /**
   * Simulate one tick of the Raft protocol.
   * Order: elections first, then heartbeats/replication, then clock advance.
   */
  tick(): void {
    // 1. Check each node for election timeout
    for (const node of this.nodes) {
      if (node.isElectionTimedOut() && node.role !== 'leader') {
        this.runElection(node.nodeId);
      }
    }

    // 2. Leaders send heartbeats and replicate log entries
    for (const node of this.nodes) {
      if (node.role === 'leader') {
        this.runHeartbeats(node.nodeId);
      }
    }

    // 3. Advance clock
    this.advanceClock(this.clock + 1);
  }

  /**
   * Simulate until a leader is elected or max ticks reached.
   */
  simulateUntilLeader(maxTicks: number = 1000): { leaderId: number | null; term: number } {
    for (let i = 0; i < maxTicks; i++) {
      this.tick();
      const leader = this.getLeader();
      if (leader) {
        return { leaderId: leader.nodeId, term: leader.currentTerm };
      }
    }
    return { leaderId: null, term: 0 };
  }

  /**
   * Propose a command through the leader. Returns true if accepted.
   */
  propose(command: string): boolean {
    const leader = this.getLeader();
    if (!leader) {
      return false;
    }
    return leader.propose(command);
  }

  /**
   * Get the commit index of the leader.
   */
  getLeaderCommitIndex(): number {
    const leader = this.getLeader();
    return leader?.commitIndex ?? 0;
  }

  /**
   * Get the last applied entry index on the leader.
   */
  getLeaderLastApplied(): number {
    const leader = this.getLeader();
    return leader?.lastApplied ?? 0;
  }

  /**
   * Get cluster state snapshot.
   */
  getState(): { nodes: Record<number, any>; clock: number } {
    const nodes: Record<number, any> = {};
    for (const node of this.nodes) {
      nodes[node.nodeId] = node.getState();
    }
    return { nodes, clock: this.clock };
  }

  /**
   * Get the log of a specific node.
   */
  getLog(nodeId: number): RaftNode['log'] {
    return this.nodes[nodeId]?.log ?? [];
  }

  /**
   * Count matching log entries between two nodes up to min length.
   */
  countMatchingLogEntries(aId: number, bId: number): number {
    const logA = this.nodes[aId]?.log ?? [];
    const logB = this.nodes[bId]?.log ?? [];
    const minLen = Math.min(logA.length, logB.length);
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
      if (logA[i].term === logB[i].term && logA[i].command === logB[i].command) {
        matches++;
      }
    }
    return matches;
  }

  private setupLinks(): void {
    for (let i = 0; i < this.config.nodeCount; i++) {
      for (let j = 0; j < this.config.nodeCount; j++) {
        if (i !== j) {
          const seed = this.config.seed + i * 1000 + j;
          const link = new NetworkLink(i, j, {
            baseLatency: this.config.networkLatency,
            jitterRange: this.config.networkJitter,
            packetLossPercentage: 0,
            bandwidth: 100,
          }, seed);
          this.links.set(`${i}-${j}`, link);
        }
      }
    }
  }
}
