import { describe, it, expect } from 'vitest';
import { VirtualClock } from '../src/engine/VirtualClock.ts';

describe('VirtualClock', () => {
  it('should start at zero', () => {
    const clock = new VirtualClock();
    expect(clock.time).toBe(0);
  });

  it('should allow advancing forward', () => {
    const clock = new VirtualClock();
    clock.advance(10);
    expect(clock.time).toBe(10);
    clock.advance(20);
    expect(clock.time).toBe(20);
  });

  it('should throw when going backward', () => {
    const clock = new VirtualClock();
    clock.advance(10);
    expect(() => clock.advance(5)).toThrow(/backward/);
  });

  it('should allow reset to zero', () => {
    const clock = new VirtualClock();
    clock.advance(10);
    clock.reset();
    expect(clock.time).toBe(0);
  });

  it('should allow setting via property', () => {
    const clock = new VirtualClock();
    clock.time = 100;
    expect(clock.time).toBe(100);
  });

  it('should prevent negative times', () => {
    const clock = new VirtualClock();
    expect(() => { clock.time = -1; }).toThrow(/backward/);
  });

  it('should be idempotent on same value', () => {
    const clock = new VirtualClock();
    clock.time = 5;
    clock.time = 5; // same value — should not throw
    expect(clock.time).toBe(5);
  });
});
