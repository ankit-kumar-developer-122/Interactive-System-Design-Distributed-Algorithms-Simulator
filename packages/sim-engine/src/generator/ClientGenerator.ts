import { Xorshift128Plus } from '../engine/Xorshift128Plus.js';
import type { Packet } from '../network/Packet.js';
import { createPacket } from '../network/Packet.js';

/** Traffic pattern types */
export type TrafficPattern = 'constant' | 'burst' | 'poisson';

/** Configuration for a client generator */
export interface ClientGeneratorConfig {
  /** Client/node ID this generator represents */
  clientId: number;
  /** Target node(s) to send to */
  targets: number[];
  /** Traffic pattern */
  pattern: TrafficPattern;
  /** Base interval between packets (virtual time units) */
  interval: number;
  /** Burst multiplier for burst pattern */
  burstMultiplier: number;
  /** Number of packets in a burst */
  burstSize: number;
  /** Average inter-arrival time for Poisson distribution */
  poissonMean: number;
  /** Seed for deterministic randomness */
  seed: number;
}

/** Default configuration */
const DEFAULT_CONFIG: ClientGeneratorConfig = {
  clientId: 0,
  targets: [1],
  pattern: 'constant',
  interval: 10,
  burstMultiplier: 3,
  burstSize: 5,
  poissonMean: 10,
  seed: 42,
};

/**
 * ClientGenerator creates packets according to specified traffic patterns:
 * - Constant: Regular intervals
 * - Burst: Groups of packets sent together
 * - Poisson: Random intervals following exponential distribution
 */
export class ClientGenerator {
  private config: ClientGeneratorConfig;
  private rng: Xorshift128Plus;
  private nextInterval: number;
  private packetCounter: number;
  private burstPhase: 'idle' | 'bursting' | 'cooldown';
  private burstRemaining: number;

  constructor(config: Partial<ClientGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = new Xorshift128Plus(this.config.seed);
    this.nextInterval = this.config.interval;
    this.packetCounter = 0;
    this.burstPhase = 'idle';
    this.burstRemaining = 0;
  }

  /** Get current configuration */
  getConfig(): Readonly<ClientGeneratorConfig> {
    return { ...this.config };
  }

  /** Generate the next packet at the given timestamp */
  generatePacket(currentTime: number): Packet | null {
    this.packetCounter++;
    const targetId = this.config.targets[
      (this.packetCounter - 1) % this.config.targets.length
    ];

    let interval: number;
    let shouldGenerate = false;

    switch (this.config.pattern) {
      case 'constant':
        shouldGenerate = currentTime >= this.nextInterval;
        if (shouldGenerate) {
          this.nextInterval += this.config.interval;
        }
        break;

      case 'burst':
        shouldGenerate = this.shouldBurstGenerate(currentTime);
        break;

      case 'poisson':
        shouldGenerate = currentTime >= this.nextInterval;
        if (shouldGenerate) {
          // Exponential distribution for Poisson arrivals
          const nextTick = this.exponentialSample();
          this.nextInterval = currentTime + nextTick;
        }
        break;
    }

    if (!shouldGenerate) {
      return null;
    }

    const packet = createPacket(
      `pkt_${this.config.clientId}_${this.packetCounter}`,
      this.config.clientId,
      targetId,
      { ts: currentTime },
      currentTime
    );

    return packet;
  }

  /** Generate a batch of packets for burst pattern */
  generateBatch(count: number, currentTime: number): Packet[] {
    const packets: Packet[] = [];
    for (let i = 0; i < count; i++) {
      const pkt = this.generatePacket(currentTime + i * 0.1); // Small offset within burst
      if (pkt) {
        packets.push(pkt);
      }
    }
    return packets;
  }

  /** Reset generator state */
  reset(): void {
    this.rng = new Xorshift128Plus(this.config.seed);
    this.nextInterval = this.config.interval;
    this.packetCounter = 0;
    this.burstPhase = 'idle';
    this.burstRemaining = 0;
  }

  private shouldBurstGenerate(currentTime: number): boolean {
    switch (this.burstPhase) {
      case 'idle':
        // Check if it's time to start a burst
        if (currentTime >= this.nextInterval) {
          this.burstPhase = 'bursting';
          this.burstRemaining = this.config.burstSize;
          return true;
        }
        break;

      case 'bursting':
        if (this.burstRemaining > 0) {
          this.burstRemaining--;
          if (this.burstRemaining === 0) {
            this.burstPhase = 'cooldown';
            // Cooldown period before next burst
            this.nextInterval = currentTime + this.config.interval * this.config.burstMultiplier;
          }
          return true;
        }
        break;

      case 'cooldown':
        if (currentTime >= this.nextInterval) {
          this.burstPhase = 'idle';
        }
        break;
    }
    return false;
  }

  /** Sample from exponential distribution using inverse transform */
  private exponentialSample(): number {
    // Use Box-Muller or simple inverse transform: -mean * ln(1-U)
    const u = this.rng.next();
    // Avoid log(0) by ensuring u > 0
    const adjustedU = Math.max(u, 0.0001);
    return -this.config.poissonMean * Math.log(adjustedU);
  }
}
