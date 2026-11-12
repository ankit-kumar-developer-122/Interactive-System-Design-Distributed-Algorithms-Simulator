/**
 * A seedable xorshift128+ pseudo-random number generator.
 * Provides deterministic randomness suitable for simulation.
 */
export class Xorshift128Plus {
  // State consists of two 64-bit values (each stored as Uint32 pairs)
  private s: [number, number, number, number];
  private static readonly MASK = 0xffffffff;
  private static readonly MASK_HIGH = 0xffffffff00000000;

  constructor(seed: number) {
    // Derive four 32-bit state words from a single integer seed
    this.s = this.seedToState(seed);
  }

  private seedToState(seed: number): [number, number, number, number] {
    // Simple LCG-based seed expansion to fill the 128-bit state
    const s0 = seed & 0xffffffff;
    const s1 = ((seed >>> 16) ^ (seed << 15)) & 0xffffffff;
    const s2 = ((seed * 1103515245 + 12345) >>> 0) & 0xffffffff;
    const s3 = ((seed * 214013 + 2531011) >>> 0) & 0xffffffff;
    return [s0, s1, s2, s3];
  }

  /** Get the current state as a serializable Uint32Array. */
  getState(): Uint32Array {
    return new Uint32Array(this.s);
  }

  /** Restore state from a previously saved Uint32Array (for snapshot restore). */
  setState(state: Uint32Array | number[]): void {
    this.s = [
      Number(state[0]),
      Number(state[1]),
      Number(state[2]),
      Number(state[3]),
    ];
  }

  /** Generate the next random number (64-bit output as a float in [0, 1)). */
  next(): number {
    let s1 = this.s[0];
    let s0 = this.s[1];
    const result = (this.s[0] + this.s[3]) >>> 0;

    s1 ^= s1 << 23;
    s1 = (s1 ^ s0 ^ (s1 >>> 17) ^ (s0 >>> 26)) >>> 0;

    this.s[0] = this.s[1];
    this.s[1] = this.s[2];
    this.s[2] = this.s[3];
    this.s[3] = s1;

    // Return as float in [0, 1) using a safe mix of state bits
    // Use upper 31 bits of each part to stay within positive range
    const hi = (result >>> 1) & 0x7fffffff;
    const lo = (s0 >>> 1) & 0x7fffffff;
    const mixed = ((hi >>> 12) ^ lo) & 0x7fffff;
    return (mixed + 1) / 8388609; // 2^23
  }

  /** Generate a random integer in [0, max). */
  nextInt(max: number): number {
    if (max <= 0) {
      throw new Error('nextInt requires max > 0');
    }
    return Math.floor(this.next() * max);
  }

  /** Generate a random integer in [min, max). */
  nextRange(min: number, max: number): number {
    if (min >= max) {
      throw new Error('nextIntRange requires min < max');
    }
    return min + this.nextInt(max - min);
  }
}
