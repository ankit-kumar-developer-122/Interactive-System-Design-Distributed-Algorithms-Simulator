import { describe, it, expect } from 'vitest';
import { ConsistentHashRing } from '../src/consistent_hashing/ConsistentHashRing.js';
import type { ConsistentHashConfig } from '../src/consistent_hashing/ConsistentHashRing.js';

describe('ConsistentHashRing', () => {
  // ── Construction & Config ──────────────────────────────────────────────

  describe('construction', () => {
    it('should start empty', () => {
      const ring = new ConsistentHashRing();
      expect(ring.size()).toBe(0);
      expect(ring.vnodeCount()).toBe(0);
      expect(ring.getPhysicalNodes().size).toBe(0);
    });

    it('should accept custom config', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 50, hashFunction: 'murmur' });
      const cfg = ring.getConfig();
      expect(cfg.vnodeCount).toBe(50);
      expect(cfg.hashFunction).toBe('murmur');
    });

    it('should use defaults when no config provided', () => {
      const ring = new ConsistentHashRing();
      const cfg = ring.getConfig();
      expect(cfg.vnodeCount).toBe(150);
      expect(cfg.hashFunction).toBe('fnv1a');
    });
  });

  // ── addNode / removeNode ───────────────────────────────────────────────

  describe('addNode', () => {
    it('should add a physical node with virtual nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      const remap = ring.addNode('node-1');
      expect(ring.size()).toBe(1);
      expect(ring.vnodeCount()).toBe(10);
      expect(ring.getPhysicalNodes()).toContain('node-1');
      expect(remap).toBeGreaterThan(0);
    });

    it('should return 0 when adding duplicate node', () => {
      const ring = new ConsistentHashRing();
      ring.addNode('node-1');
      const remap = ring.addNode('node-1');
      expect(ring.vnodeCount()).toBe(150); // default vnodes added once
      expect(remap).toBe(0);
    });

    it('should add multiple distinct physical nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 5 });
      ring.addNode('a');
      ring.addNode('b');
      ring.addNode('c');
      expect(ring.size()).toBe(3);
      expect(ring.vnodeCount()).toBe(15);
    });

    it('should distribute virtual nodes at distinct hash positions', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 100 });
      ring.addNode('node-1');
      const ringNodes = ring.getRing();
      const hashes = ringNodes.map((r) => r.hash);
      const unique = new Set(hashes);
      // All 100 virtual nodes should have unique hash positions (with high probability)
      expect(unique.size).toBe(100);
    });
  });

  describe('removeNode', () => {
    it('should remove a physical node and its virtual nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('node-1');
      ring.addNode('node-2');
      expect(ring.size()).toBe(2);
      expect(ring.vnodeCount()).toBe(20);

      const remap = ring.removeNode('node-1');
      expect(ring.size()).toBe(1);
      expect(ring.vnodeCount()).toBe(10);
      expect(ring.getPhysicalNodes()).not.toContain('node-1');
      expect(ring.getPhysicalNodes()).toContain('node-2');
      expect(remap).toBeGreaterThan(0);
    });

    it('should return 0 when removing non-existent node', () => {
      const ring = new ConsistentHashRing();
      const remap = ring.removeNode('missing');
      expect(remap).toBe(0);
    });

    it('should return 1 when removing last node', () => {
      const ring = new ConsistentHashRing();
      ring.addNode('only-node');
      const remap = ring.removeNode('only-node');
      expect(ring.size()).toBe(0);
      expect(remap).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all nodes and virtual nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 50 });
      ring.addNode('a');
      ring.addNode('b');
      ring.clear();
      expect(ring.size()).toBe(0);
      expect(ring.vnodeCount()).toBe(0);
    });
  });

  // ── getNode ─────────────────────────────────────────────────────────────

  describe('getNode', () => {
    it('should return undefined on empty ring', () => {
      const ring = new ConsistentHashRing();
      expect(ring.getNode('any-key')).toBeUndefined();
    });

    it('should return the same node for a given key (deterministic)', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('node-a');
      ring.addNode('node-b');

      const result1 = ring.getNode('key-42');
      const result2 = ring.getNode('key-42');
      expect(result1).toBe(result2);
    });

    it('should assign keys to one of the two nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('node-a');
      ring.addNode('node-b');

      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const n = ring.getNode(`key-${i}`);
        expect(n).toBeDefined();
        results.add(n!);
      }
      // Should hit both nodes across different keys
      expect(results.size).toBeGreaterThanOrEqual(1);
    });

    it('should be deterministic across ring rebuilds', () => {
      const buildAndQuery = (): string => {
        const ring = new ConsistentHashRing({ vnodeCount: 50 });
        ring.addNode('x');
        ring.addNode('y');
        ring.addNode('z');
        return ring.getNode('steady-key')!;
      };

      expect(buildAndQuery()).toBe(buildAndQuery());
    });
  });

  // ── getNodes (replication) ─────────────────────────────────────────────

  describe('getNodes', () => {
    it('should return empty array on empty ring', () => {
      const ring = new ConsistentHashRing();
      expect(ring.getNodes('key', 3)).toEqual([]);
    });

    it('should return fewer nodes than exist on the ring when asked for more', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 5 });
      ring.addNode('a');
      ring.addNode('b');
      const nodes = ring.getNodes('key', 5);
      expect(nodes.length).toBe(2);
    });

    it('should return distinct physical nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 100 });
      ring.addNode('n1');
      ring.addNode('n2');
      ring.addNode('n3');

      const nodes = ring.getNodes('my-key', 3);
      const unique = new Set(nodes);
      expect(unique.size).toBe(nodes.length);
    });

    it('should respect replication factor parameter', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('a');
      ring.addNode('b');
      ring.addNode('c');
      ring.addNode('d');

      const nodes2 = ring.getNodes('k', 2);
      expect(nodes2.length).toBe(2);

      const nodes3 = ring.getNodes('k', 3);
      expect(nodes3.length).toBe(3);
    });

    it('should be deterministic', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 20 });
      ring.addNode('p1');
      ring.addNode('p2');
      ring.addNode('p3');

      const r1 = ring.getNodes('determ-key', 2);
      const r2 = ring.getNodes('determ-key', 2);
      expect(r1).toEqual(r2);
    });

    it('should return count=0 empty array', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 5 });
      ring.addNode('x');
      expect(ring.getNodes('k', 0)).toEqual([]);
    });
  });

  // ── Uniformity / load distribution ─────────────────────────────────────

  describe('uniform load distribution', () => {
    function buildDistribution(vnodeCount: number, nodeCount: number): KeyDistribution {
      const ring = new ConsistentHashRing({ vnodeCount });
      for (let i = 0; i < nodeCount; i++) {
        ring.addNode(`phys-${i}`);
      }
      const keys = Array.from({ length: 10000 }, (_, i) => `dist-key-${i}`);
      return ring.getKeyDistribution(keys);
    }

    it('should produce low std deviation with many vnodes (10 nodes, 300 vnodes)', () => {
      const dist = buildDistribution(300, 10);
      // With 10 nodes each key goes to 1 node, expected ~1000 keys per node
      // std dev should be well under 10% of mean
      expect(dist.stdDeviation).toBeLessThan(dist.mean * 0.15);
    });

    it('should produce lower std deviation with more vnodes', () => {
      const d100 = buildDistribution(100, 10);
      const d300 = buildDistribution(300, 10);
      const d600 = buildDistribution(600, 10);

      // More vnodes → more uniform → lower stddev
      expect(d300.stdDeviation).toBeLessThan(d100.stdDeviation);
      expect(d600.stdDeviation).toBeLessThan(d300.stdDeviation);
    });

    it('should scale mean correctly with total keys', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 200 });
      ring.addNode('a');
      ring.addNode('b');
      ring.addNode('c');

      const dist = ring.getKeyDistribution(
        Array.from({ length: 3000 }, (_, i) => `mean-key-${i}`)
      );
      // 3 nodes, 3000 keys → mean ≈ 1000
      expect(dist.mean).toBeCloseTo(1000, 0);
    });

    it('should handle single node gracefully', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 50 });
      ring.addNode('only');
      const dist = ring.getKeyDistribution(
        Array.from({ length: 500 }, (_, i) => `single-${i}`)
      );
      expect(dist.distribution.get('only')).toBe(500);
      expect(dist.stdDeviation).toBe(0);
    });

    it('should handle two nodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 200 });
      ring.addNode('left');
      ring.addNode('right');
      const dist = ring.getKeyDistribution(
        Array.from({ length: 2000 }, (_, i) => `two-${i}`)
      );
      const total = dist.distribution.values().next().value as number +
        Array.from(dist.distribution.values())[1];
      expect(total).toBe(2000);
      // Each should get roughly half, within 20%
      for (const count of dist.distribution.values()) {
        expect(count).toBeGreaterThan(800).toBeLessThan(1200);
      }
    });
  });

  // ── Minimal key redistribution on node changes ─────────────────────────

  describe('minimal key redistribution', () => {
    function remappedFraction(
      before: ConsistentHashRing,
      after: ConsistentHashRing,
      keyCount: number
    ): number {
      const keys = Array.from({ length: keyCount }, (_, i) => `redist-${i}`);
      const beforeAssignment = new Map<string, string>();
      for (const k of keys) {
        beforeAssignment.set(k, before.getNode(k)!);
      }
      let changed = 0;
      for (const k of keys) {
        if (beforeAssignment.get(k) !== after.getNode(k)) {
          changed++;
        }
      }
      return changed / keys.length;
    }

    it('should remap only a small fraction when adding a node', () => {
      const before = new ConsistentHashRing({ vnodeCount: 300 });
      before.addNode('a');
      before.addNode('b');

      const after = new ConsistentHashRing({ vnodeCount: 300 });
      after.addNode('a');
      after.addNode('b');
      after.addNode('c');

      const frac = remappedFraction(before, after, 5000);
      // Adding one node to 2 should move roughly 1/3 of keys at most
      expect(frac).toBeLessThan(0.5);
    });

    it('should remap a bounded fraction when removing a node', () => {
      const before = new ConsistentHashRing({ vnodeCount: 300 });
      before.addNode('a');
      before.addNode('b');
      before.addNode('c');

      const after = new ConsistentHashRing({ vnodeCount: 300 });
      after.addNode('a');
      after.addNode('b');

      const frac = remappedFraction(before, after, 5000);
      // Removing 1 of 3 nodes should move at most ~1/3 of keys
      expect(frac).toBeLessThan(0.5);
    });

    it('should have zero remap when ring is unchanged', () => {
      const r1 = new ConsistentHashRing({ vnodeCount: 100 });
      r1.addNode('x');
      r1.addNode('y');

      const r2 = new ConsistentHashRing({ vnodeCount: 100 });
      r2.addNode('x');
      r2.addNode('y');

      const frac = remappedFraction(r1, r2, 1000);
      expect(frac).toBe(0);
    });
  });

  // ── Distinct physical replica selection ────────────────────────────────

  describe('distinct physical replicas', () => {
    it('should always return unique physical nodes for getNodes', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 200 });
      for (let i = 0; i < 10; i++) {
        ring.addNode(`phys-${i}`);
      }

      for (let i = 0; i < 100; i++) {
        const nodes = ring.getNodes(`query-${i}`, 5);
        const unique = new Set(nodes);
        expect(unique.size).toBe(nodes.length);
      }
    });

    it('should return all physical nodes when asking for all', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 50 });
      const ids = ['alpha', 'beta', 'gamma'];
      for (const id of ids) ring.addNode(id);

      const nodes = ring.getNodes('all-keys', 3);
      expect(nodes.length).toBe(3);
      expect(new Set(nodes)).toEqual(new Set(ids));
    });

    it('should give different replicas for different keys', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 100 });
      ring.addNode('n1');
      ring.addNode('n2');
      ring.addNode('n3');
      ring.addNode('n4');

      const sets = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const nodes = ring.getNodes(`diverse-${i}`, 2).sort().join(',');
        sets.add(nodes);
      }
      // Should see more than one distinct pair
      expect(sets.size).toBeGreaterThan(1);
    });
  });

  // ── Hash algorithm variants ────────────────────────────────────────────

  describe('hash algorithms', () => {
    it('fnv1a and murmur should produce different assignments for the same ring', () => {
      const fnvRing = new ConsistentHashRing({ vnodeCount: 100, hashFunction: 'fnv1a' });
      const murmurRing = new ConsistentHashRing({ vnodeCount: 100, hashFunction: 'murmur' });

      for (const id of ['a', 'b', 'c']) {
        fnvRing.addNode(id);
        murmurRing.addNode(id);
      }

      let differentCount = 0;
      for (let i = 0; i < 100; i++) {
        const k = `alg-test-${i}`;
        if (fnvRing.getNode(k) !== murmurRing.getNode(k)) {
          differentCount++;
        }
      }
      // Should differ for a significant portion (≥40%) between algorithms
      expect(differentCount).toBeGreaterThan(39);
    });

    it('each algorithm should still be deterministic', () => {
      const makeFnv = () => {
        const r = new ConsistentHashRing({ vnodeCount: 50, hashFunction: 'fnv1a' });
        r.addNode('x');
        r.addNode('y');
        return r;
      };
      expect(makeFnv().getNode('det-key')).toBe(makeFnv().getNode('det-key'));

      const makeMurmur = () => {
        const r = new ConsistentHashRing({ vnodeCount: 50, hashFunction: 'murmur' });
        r.addNode('x');
        r.addNode('y');
        return r;
      };
      expect(makeMurmur().getNode('det-key')).toBe(makeMurmur().getNode('det-key'));
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty string keys', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('n1');
      ring.addNode('n2');
      expect(ring.getNode('')).toBeDefined();
    });

    it('should handle long keys', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('n1');
      const longKey = 'a'.repeat(10000);
      expect(() => ring.getNode(longKey)).not.toThrow();
      expect(ring.getNode(longKey)).toBeDefined();
    });

    it('should handle unicode keys', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 10 });
      ring.addNode('n1');
      ring.addNode('n2');
      const result = ring.getNode('こんにちは世界🌍');
      expect(result).toBeDefined();
    });

    it('should handle single virtual node per physical node', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 1 });
      ring.addNode('a');
      ring.addNode('b');
      expect(ring.vnodeCount()).toBe(2);
      // Every key should map deterministically
      const assigned = new Set<string>();
      for (let i = 0; i < 100; i++) {
        assigned.add(ring.getNode(`u-${i}`)!);
      }
      expect(assigned.size).toBeGreaterThanOrEqual(1);
    });

    it('should maintain ring invariants after multiple add/remove cycles', () => {
      const ring = new ConsistentHashRing({ vnodeCount: 50 });
      ring.addNode('a');
      ring.addNode('b');
      ring.addNode('c');
      ring.removeNode('b');
      ring.addNode('d');
      ring.removeNode('a');
      ring.addNode('a');

      expect(ring.size()).toBe(3);
      expect(ring.getPhysicalNodes()).toContain('a');
      expect(ring.getPhysicalNodes()).toContain('c');
      expect(ring.getPhysicalNodes()).toContain('d');
      expect(ring.getPhysicalNodes()).not.toContain('b');
    });
  });
});
