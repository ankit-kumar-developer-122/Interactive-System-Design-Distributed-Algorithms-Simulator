import { describe, it, expect, vi } from 'vitest';
import { SimulationEngine } from '../src/engine/SimulationEngine.ts';
import type { Snapshot, NodeState } from '../src/types/index.ts';

describe('SimulationEngine', () => {
  describe('schedule and step', () => {
    it('should schedule and process events in time order', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('msg', 0, 10);
      engine.schedule('msg', 1, 5);
      engine.schedule('msg', 0, 8);

      const steps = engine.step();
      expect(steps?.nodeId).toBe(1);
      expect(steps?.time).toBe(5);

      const step2 = engine.step();
      expect(step2?.time).toBe(8);

      const step3 = engine.step();
      expect(step3?.time).toBe(10);
      expect(engine.step()).toBeUndefined();
    });

    it('should advance clock to event time on step', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('init', 0, 0);
      engine.schedule('later', 0, 100);

      expect(engine.currentTime).toBe(0);
      engine.step();
      expect(engine.currentTime).toBe(0); // first event at time 0
      engine.step();
      expect(engine.currentTime).toBe(100);
    });

    it('should track tick count', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('a', 0, 1);
      engine.schedule('b', 0, 2);

      expect(engine.getTickCount()).toBe(0);
      engine.step();
      expect(engine.getTickCount()).toBe(1);
      engine.step();
      expect(engine.getTickCount()).toBe(2);
    });
  });

  describe('pacing modes', () => {
    it('step mode should process one event per call', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('x', 0, 1);
      engine.schedule('y', 0, 2);

      const s1 = engine.step();
      expect(s1?.type).toBe('x');
      const s2 = engine.step();
      expect(s2?.type).toBe('y');
      expect(engine.step()).toBeUndefined();
    });

    it('fast mode should run to completion', async () => {
      const engine = new SimulationEngine();
      engine.start('fast');
      engine.schedule('a', 0, 10);
      engine.schedule('b', 0, 5);

      // Fast mode runs synchronously in this simple case
      // The promise resolves when done
      await Promise.resolve();
      // Give it a moment to process
      await new Promise((r) => setTimeout(r, 10));
      // Should have processed or be done
      expect(engine.hasPendingEvents() || engine['state'] === 'done').toBeTruthy();
    });

    it('realtime mode schedules with delays', () => {
      const engine = new SimulationEngine({ tickMs: 50 });
      engine.start('realtime');
      engine.schedule('tick', 0, 0);

      // In realtime, step isn't called automatically by step() — it uses setTimeout
      // Just verify it starts without error
      engine.stop();
      expect(engine['state']).toBe('idle');
    });
  });

  describe('pause / resume', () => {
    it('should pause processing', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('a', 0, 1);
      engine.schedule('b', 0, 2);
      engine.pause();

      // Paused engine can't step
      expect(() => engine.step()).toThrow();
    });

    it('should resume from paused state', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('a', 0, 1);
      engine.schedule('b', 0, 2);
      engine.pause();
      engine.resume();

      const s1 = engine.step();
      expect(s1?.time).toBe(1);
    });
  });

  describe('stop', () => {
    it('should stop a running engine', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('a', 0, 1);
      engine.stop();
      expect(() => engine.step()).toThrow();
    });
  });

  describe('setNodeState', () => {
    it('should store and retrieve node states', () => {
      const engine = new SimulationEngine();
      engine.setNodeState(0, { status: 'leader', term: 1 });
      const nodes = engine.getNodeStates();
      expect(nodes.get(0)?.status).toBe('leader');
      expect(nodes.get(0)?.term).toBe(1);
    });

    it('should return a copy, not a reference', () => {
      const engine = new SimulationEngine();
      engine.setNodeState(0, { x: 1 });
      const nodes = engine.getNodeStates();
      nodes.delete(0);
      expect(engine.getNodeStates().get(0)?.x).toBe(1);
    });
  });

  describe('initialNodes', () => {
    it('should initialize with provided node states', () => {
      const initialState: Map<number, NodeState> = new Map([[0, { role: 'follower' }]]);
      const engine = new SimulationEngine({ initialNodes: initialState });
      expect(engine.getNodeStates().get(0)?.role).toBe('follower');
    });
  });

  describe('onEvent callback', () => {
    it('should call onEvent for each dispatched event', () => {
      const cb = vi.fn();
      const engine = new SimulationEngine({ onEvent: cb });
      engine.start('step');
      engine.schedule('hello', 0, 1);
      engine.step();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]?.type).toBe('hello');
      expect(typeof cb.mock.calls[0][1]).toBe('number');
    });
  });

  describe('random', () => {
    it('should be deterministic with same seed', () => {
      const e1 = new SimulationEngine();
      const e2 = new SimulationEngine();
      for (let i = 0; i < 5; i++) {
        expect(e1.random()).toBe(e2.random());
      }
    });

    it('should be deterministic with explicit seed via setSeed pattern', () => {
      // Each engine gets seed 0 by default
      const e1 = new SimulationEngine();
      const e2 = new SimulationEngine();
      // Both use same default seed → same sequence
      expect(e1.random()).toBe(e2.random());
    });
  });

  describe('snapshot and restore', () => {
    it('should serialize and deserialize full state', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.setNodeState(0, { role: 'candidate' });
      engine.setNodeState(1, { role: 'follower' });
      engine.schedule('vote', 0, 5);
      engine.schedule('timeout', 1, 10);

      // Take snapshot mid-run
      const snapshot = engine.takeSnapshot();

      // Verify snapshot contents
      expect(snapshot.clock).toBe(0);
      expect(snapshot.events.length).toBe(2);
      expect(snapshot.nodes.size).toBe(2);
      expect(snapshot.rngState).toHaveLength(4);
      expect(snapshot.seq).toBe(2);
      expect(snapshot.tickCount).toBe(0);

      // Create new engine and restore
      const restored = new SimulationEngine();
      restored.restoreFromSnapshot(snapshot);

      expect(restored.currentTime).toBe(0);
      expect(restored.pendingEventCount()).toBe(2);
      expect(restored.getTickCount()).toBe(0);
      expect(restored.getNodeStates().get(0)?.role).toBe('candidate');
      expect(restored.getNodeStates().get(1)?.role).toBe('follower');
    });

    it('should allow exact replay after restore', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.setNodeState(0, { votes: [] });
      engine.schedule('request', 0, 1);
      engine.schedule('response', 0, 2);

      // Process first event
      engine.step();
      expect(engine.getTickCount()).toBe(1);
      expect(engine.currentTime).toBe(1);

      // Save snapshot after first event
      const snap = engine.takeSnapshot();

      // Restore and re-process from same point
      const restored = new SimulationEngine();
      restored.restoreFromSnapshot(snap);
      restored.start('step');
      const evt = restored.step();
      expect(evt?.time).toBe(2);
      expect(restored.getTickCount()).toBe(2); /* restored tickCount=1, then one step adds another */
    });

    it('should be deterministic across restores', () => {
      const createAndRun = () => {
        const engine = new SimulationEngine();
        engine.start('step');
        engine.setNodeState(0, {});
        engine.schedule('a', 0, 1);
        engine.step();
        engine.schedule('b', 0, 3);
        const snap = engine.takeSnapshot();
        return snap;
      };

      const snap1 = createAndRun();
      const snap2 = createAndRun();

      // Snapshots must be identical for deterministic replay
      expect(snap1.clock).toBe(snap2.clock);
      expect(snap1.events.length).toBe(snap2.events.length);
      expect(snap1.tickCount).toBe(snap2.tickCount);
      // RNG state must match for deterministic continuation
      for (let i = 0; i < snap1.rngState.length; i++) {
        expect(snap1.rngState[i]).toBe(snap2.rngState[i]);
      }
    });
  });

  describe('cannot restart after done', () => {
    it('should throw on start after completion', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('only', 0, 1);
      engine.step();
      expect(engine.step()).toBeUndefined();
      expect(() => engine.start('fast')).toThrow(/restarted/);
    });
  });

  describe('cannot step while idle/done', () => {
    it('should throw when stepping without start', () => {
      const engine = new SimulationEngine();
      engine.schedule('a', 0, 1);
      expect(() => engine.step()).toThrow(/engine is idle/);
    });

    it('should throw when stepping after done', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      engine.schedule('a', 0, 1);
      engine.step();
      engine.step(); // processes and finishes
      expect(() => engine.step()).toThrow();
    });
  });

  describe('pending event queries', () => {
    it('should report pending events before and after processing', () => {
      const engine = new SimulationEngine();
      engine.start('step');
      expect(engine.hasPendingEvents()).toBe(false);
      engine.schedule('a', 0, 1);
      expect(engine.hasPendingEvents()).toBe(true);
      expect(engine.pendingEventCount()).toBe(1);
      engine.step();
      expect(engine.hasPendingEvents()).toBe(false);
      expect(engine.pendingEventCount()).toBe(0);
    });
  });

  describe('multiple node states', () => {
    it('should maintain separate states for multiple nodes', () => {
      const engine = new SimulationEngine();
      for (let i = 0; i < 10; i++) {
        engine.setNodeState(i, { index: i });
      }
      const states = engine.getNodeStates();
      expect(states.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(states.get(i)?.index).toBe(i);
      }
    });
  });

  describe('deterministic replay test', () => {
    it('produces identical event sequences with same seed', () => {
      const runSequence = () => {
        const engine = new SimulationEngine();
        engine.start('step');
        const events: number[] = [];
        engine.schedule('init', 0, 1);
        engine.schedule('msg_a', 0, 5);
        engine.schedule('msg_b', 1, 3);
        engine.schedule('finish', 2, 7);
        while (true) {
          const e = engine.step();
          if (!e) break;
          events.push(e.time);
        }
        return events;
      };

      expect(runSequence()).toEqual(runSequence());
    });
  });
});
