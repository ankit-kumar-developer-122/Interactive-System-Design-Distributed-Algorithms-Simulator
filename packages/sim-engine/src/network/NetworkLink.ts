import { Xorshift128Plus } from '../engine/Xorshift128Plus.js';
import type { Packet } from './Packet.js';

/** Jitter distribution types */
export type JitterType = 'uniform' | 'gaussian';

/** Configuration for a network link between two nodes */
export interface NetworkLinkConfig {
  /** Base latency in virtual time units */
  baseLatency: number;
  /** Maximum jitter range for uniform distribution or std deviation for gaussian */
  jitterRange: number;
  /** Type of jitter distribution */
  jitterType: JitterType;
  /** Packet loss percentage (0-100) */
  packetLossPercentage: number;
  /** Bandwidth in packets per time unit (affects serialization delay) */
  bandwidth: number;
  /** Whether the link is currently partitioned (broken) */
  partitioned: boolean;
}

/** Default configuration */
const DEFAULT_CONFIG: NetworkLinkConfig = {
  baseLatency: 10,
  jitterRange: 5,
  jitterType: 'uniform',
  packetLossPercentage: 0,
  bandwidth: 1,
  partitioned: false,
};

/**
 * NetworkLink simulates a communication channel between two nodes
 * with configurable latency, jitter, packet loss, and bandwidth.
 */
export class NetworkLink {
  private config: NetworkLinkConfig;
  private rng: Xorshift128Plus;
  /** Packets awaiting transmission on this link */
  private pendingPackets: Packet[] = [];
  /** Packets that have been transmitted but not yet delivered */
  private inflightPackets: Packet[] = [];

  constructor(
    from: number,
    to: number,
    config: Partial<NetworkLinkConfig> = {},
    seed?: number
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = seed !== undefined ? new Xorshift128Plus(seed) : new Xorshift128Plus(0);
    this.from = from;
    this.to = to;
  }

  readonly from: number;
  readonly to: number;

  /** Get current link configuration */
  getConfig(): Readonly<NetworkLinkConfig> {
    return { ...this.config };
  }

  /** Check if the link is partitioned */
  isPartitioned(): boolean {
    return this.config.partitioned;
  }

  /** Toggle link partition state */
  setPartitioned(partitioned: boolean): void {
    this.config.partitioned = partitioned;
  }

  /** Update link configuration */
  updateConfig(updates: Partial<NetworkLinkConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Send a packet through this link.
   * Returns null if the packet is dropped due to partition or packet loss.
   * Otherwise returns the packet with estimated arrival time set.
   */
  send(packet: Packet, currentTime: number): Packet | null {
    // Partitioned links drop all packets
    if (this.config.partitioned) {
      packet.dropped = true;
      return null;
    }

    // Apply packet loss based on configured percentage
    const lossRoll = this.rng.next() * 100;
    if (lossRoll < this.config.packetLossPercentage) {
      packet.dropped = true;
      return null;
    }

    // Calculate total delay: base latency + jitter + serialization delay
    const jitter = this.calculateJitter();
    const serializationDelay = this.calculateSerializationDelay();
    const totalDelay = this.config.baseLatency + Math.abs(jitter) + serializationDelay;

    const estimatedArrival = currentTime + totalDelay;
    packet.estimatedArrival = estimatedArrival;
    packet.dropped = false;
    packet.createdAt = currentTime;

    // Add to pending queue for bandwidth-limited transmission
    this.pendingPackets.push(packet);

    return packet;
  }

  /**
   * Process pending packets and deliver any that are ready.
   * Limited by bandwidth (packets delivered per time unit).
   * A packet becomes eligible for delivery once its estimated arrival time is reached.
   */
  processPackets(currentTime: number, maxProcessingRate?: number): Packet[] {
    const rate = maxProcessingRate ?? this.config.bandwidth;
    const delivered: Packet[] = [];

    // Sort pending packets by estimated arrival time (FIFO by readiness)
    this.pendingPackets.sort((a, b) => a.estimatedArrival - b.estimatedArrival);

    let processed = 0;
    const availableSlots = Math.max(1, Math.ceil(rate));

    while (processed < availableSlots && this.pendingPackets.length > 0) {
      const next = this.pendingPackets[0];
      if (next.estimatedArrival <= currentTime) {
        const p = this.pendingPackets.shift()!;
        p.delivered = true;
        delivered.push(p);
        processed++;
      } else {
        break;
      }
    }

    return delivered;
  }

  /** Clear all pending and in-flight packets */
  clearPending(): void {
    this.pendingPackets = [];
    this.inflightPackets = [];
  }

  /** Calculate jitter based on configured distribution type */
  private calculateJitter(): number {
    const range = this.config.jitterRange;
    if (this.config.jitterType === 'uniform') {
      // Uniform distribution in [-range, +range]
      return (this.rng.next() * 2 * range) - range;
    } else {
      // Gaussian-like approximation using sum of uniform randoms (CLT)
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += this.rng.next();
      }
      // Standard normal: mean=0, std=1
      // Scale to desired range
      return (sum - 6) * range;
    }
  }

  /** Calculate serialization delay based on bandwidth */
  private calculateSerializationDelay(): number {
    if (this.config.bandwidth <= 0) {
      return Infinity; // Cannot send
    }
    // Approximate: 1/bandwidth gives time per packet
    return 1 / this.config.bandwidth;
  }

  /** Get number of packets waiting in the send queue */
  pendingCount(): number {
    return this.pendingPackets.length;
  }

  /** Get number of packets in flight (transmitted but not yet delivered) */
  inflightCount(): number {
    return this.inflightPackets.length;
  }
}
