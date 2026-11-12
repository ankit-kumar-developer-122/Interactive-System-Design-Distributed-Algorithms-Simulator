import { describe, it, expect } from 'vitest';
import { Xorshift128Plus } from '../src/engine/Xorshift128Plus.ts';

describe('Xorshift128Plus', () => {
  it('should produce deterministic output for a given seed', () => {
    const rng1 = new Xorshift128Plus(42);
    const rng2 = new Xorshift128Plus(42);
    for (let i = 0; i < 10; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('should produce different output for different seeds', () => {
    const rng1 = new Xorshift128Plus(42);
    const rng2 = new Xorshift128Plus(43);
    expect(rng1.next()).not.toBe(rng2.next());
  });

  it('should always return values in [0, 1)', () => {
    const rng = new Xorshift128Plus(0);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('should return consistent state after serialization round-trip', () => {
    // Generate some initial values, save state, then continue from that state
    const rng1 = new Xorshift128Plus(42);
    const initial: number[] = [];
    for (let i = 0; i < 5; i++) {
      initial.push(rng1.next());
    }
    const snap = rng1.getState();
    // Continue rng1 from the saved point
    const contFromRng1: number[] = [];
    for (let i = 0; i < 5; i++) {
      contFromRng1.push(rng1.next());
    }

    // Now create a fresh engine and restore to the same snapshot state
    const rng2 = new Xorshift128Plus(0);
    rng2.setState(snap);
    const contFromRng2: number[] = [];
    for (let i = 0; i < 5; i++) {
      contFromRng2.push(rng2.next());
    }

    // Continuations must match — the restored RNG continues deterministically
    expect(contFromRng1.length).toBe(contFromRng2.length);
    for (let i = 0; i < contFromRng1.length; i++) {
      expect(contFromRng1[i]).toBe(contFromRng2[i]);
    }
  });

  it('should support nextInt', () => {
    const rng = new Xorshift128Plus(99);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(10);
    }
  });

  it('should throw on invalid nextInt', () => {
    const rng = new Xorshift128Plus(1);
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(-5)).toThrow();
  });

  it('should support nextRange', () => {
    const rng = new Xorshift128Plus(7);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextRange(5, 20);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(20);
    }
  });

  it('should throw on invalid range', () => {
    const rng = new Xorshift128Plus(1);
    expect(() => rng.nextRange(10, 5)).toThrow();
  });
});
