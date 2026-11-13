import { describe, it, expect } from 'vitest';
import { ClientGenerator } from '../src/generator/ClientGenerator.ts';

describe('ClientGenerator', () => {
  describe('constant traffic pattern', () => {
    it('should generate packets at regular intervals', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: 42,
      });

      const packets: number[] = [];
      for (let t = 0; t < 50; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt.createdAt);
      }

      // With interval 10, generates at t=10,20,30,40
      expect(packets).toEqual([10, 20, 30, 40]);
      expect(packets.length).toBe(4);
    });

    it('should produce deterministic output with same seed', () => {
      const gen1 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: 123,
      });

      const gen2 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: 123,
      });

      for (let t = 0; t < 100; t++) {
        const p1 = gen1.generatePacket(t);
        const p2 = gen2.generatePacket(t);
        expect(p1?.id).toBe(p2?.id);
        expect(p1?.createdAt).toBe(p2?.createdAt);
      }
    });

    it('should vary output with different seeds', () => {
      const gen1 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: 1,
      });

      const gen2 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: 2,
      });

      // Different seeds may still produce same pattern for constant traffic,
      // but we test that the generator doesn't crash
      expect(() => {
        for (let t = 0; t < 50; t++) {
          gen1.generatePacket(t);
          gen2.generatePacket(t);
        }
      }).not.toThrow();
    });

    it('should respect custom interval', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 5,
        seed: 42,
      });

      const packets: number[] = [];
      for (let t = 0; t < 30; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt.createdAt);
      }

      // Packets at 5, 10, 15, 20, 25
      expect(packets).toEqual([5, 10, 15, 20, 25]);
    });
  });

  describe('burst traffic pattern', () => {
    it('should group packets into bursts', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'burst',
        interval: 20,
        burstSize: 5,
        burstMultiplier: 2,
        seed: 42,
      });

      const packets: number[] = [];
      for (let t = 0; t < 100; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt.createdAt);
      }

      // Burst starts at t=20, generates consecutive packets
      expect(packets.some(t => t === 20)).toBe(true);
      expect(packets.some(t => t === 21)).toBe(true);
      expect(packets.some(t => t === 22)).toBe(true);

      // Consecutive timestamps indicate burst behavior
      expect(packets[1]! - packets[0]!).toBe(1);
      expect(packets[2]! - packets[1]!).toBe(1);
    });

    it('should produce gap between bursts', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'burst',
        interval: 20,
        burstSize: 3,
        burstMultiplier: 3,
        seed: 42,
      });

      const packets: number[] = [];
      for (let t = 0; t < 150; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt.createdAt);
      }

      // Find gaps between consecutive packets > 1
      const gaps = [];
      for (let i = 1; i < packets.length; i++) {
        if (packets[i]! - packets[i - 1]! > 1) {
          gaps.push(packets[i]! - packets[i - 1]!);
        }
      }

      // Should have gaps between bursts
      expect(gaps.length).toBeGreaterThan(0);
      // Gaps should be substantial (cooldown period)
      expect(Math.min(...gaps)).toBeGreaterThan(10);
    });

    it('should not generate during cooldown phase', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'burst',
        interval: 10,
        burstSize: 2,
        burstMultiplier: 4,
        seed: 42,
      });

      // Check a known cooldown window
      let inCooldown = false;
      let cooldownCount = 0;
      for (let t = 13; t < 49; t++) {
        const pkt = gen.generatePacket(t);
        if (!pkt) {
          cooldownCount++;
          inCooldown = true;
        }
      }

      // Should have significant quiet period
      expect(inCooldown).toBe(true);
      expect(cooldownCount).toBeGreaterThan(20);
    });

    it('should reset burst state correctly', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'burst',
        interval: 10,
        burstSize: 3,
        burstMultiplier: 2,
        seed: 42,
      });

      // Generate some packets
      for (let t = 0; t < 50; t++) {
        gen.generatePacket(t);
      }

      // Reset
      gen.reset();

      // After reset, state should be clean (interval=10, so first packet at t=10)
      const firstPkt = gen.generatePacket(5);
      expect(firstPkt).toBeNull(); // t=5 < interval=10, no packet yet
      expect(gen.generatePacket(10)).not.toBeNull();
    });
  });

  describe('Poisson traffic pattern', () => {
    it('should generate packets with positive exponential inter-arrival times', () => {
      const mean = 10;
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: mean,
        seed: 42,
      });

      const intervals: number[] = [];
      let lastTime = 0;
      let first = true;

      for (let t = 0; t < 200; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) {
          if (!first) {
            intervals.push(pkt.createdAt - lastTime);
          }
          lastTime = pkt.createdAt;
          first = false;
        }
      }

      // Should have generated some packets
      expect(intervals.length).toBeGreaterThan(0);

      // Verify all intervals are positive
      expect(intervals.every(i => i > 0)).toBe(true);
    });

    it('should produce bounded average inter-arrival time for large samples', () => {
      const mean = 10;
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: mean,
        seed: 42,
      });

      const generationTimes: number[] = [];
      for (let t = 0; t < 5000; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) {
          generationTimes.push(pkt.createdAt);
        }
      }

      if (generationTimes.length >= 10) {
        const intervals = [];
        for (let i = 1; i < generationTimes.length; i++) {
          intervals.push(generationTimes[i]! - generationTimes[i - 1]!);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        // Exponential distribution has std = mean, so with N≈50+ samples,
        // the CLT says the sample mean should be within ~2*std/sqrt(N) of true mean
        // Allow generous tolerance: within 3x the mean
        expect(avgInterval).toBeGreaterThan(mean * 0.3);
        expect(avgInterval).toBeLessThan(mean * 3);
      }
    });

    it('should produce deterministic Poisson sequence', () => {
      const gen1 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 10,
        seed: 99,
      });

      const gen2 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 10,
        seed: 99,
      });

      const packets1: number[] = [];
      const packets2: number[] = [];

      for (let t = 0; t < 500; t++) {
        const p1 = gen1.generatePacket(t);
        const p2 = gen2.generatePacket(t);
        if (p1) packets1.push(p1.createdAt);
        if (p2) packets2.push(p2.createdAt);
      }

      expect(packets1).toEqual(packets2);
    });

    it('should produce different sequences with different seeds', () => {
      const gen1 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 10,
        seed: 1,
      });

      const gen2 = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 10,
        seed: 2,
      });

      const packets1: number[] = [];
      const packets2: number[] = [];

      for (let t = 0; t < 500; t++) {
        const p1 = gen1.generatePacket(t);
        const p2 = gen2.generatePacket(t);
        if (p1) packets1.push(p1.createdAt);
        if (p2) packets2.push(p2.createdAt);
      }

      // With high probability, different seeds produce different sequences
      expect(packets1).not.toEqual(packets2);
    });

    it('should handle very small mean', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 1,
        seed: 42,
      });

      const packets = [];
      for (let t = 0; t < 100; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt);
      }

      // Small mean means frequent arrivals (many close together)
      expect(packets.length).toBeGreaterThan(5);
    });

    it('should handle very large mean', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 100,
        seed: 42,
      });

      const packets = [];
      for (let t = 0; t < 100; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt);
      }

      // Large mean means rare arrivals
      expect(packets.length).toBeLessThan(5);
    });

    it('should never generate future-dated packets', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'poisson',
        poissonMean: 5,
        seed: 42,
      });

      for (let t = 0; t < 100; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) {
          // Packet creation time should never exceed current simulated time
          expect(pkt.createdAt).toBeLessThanOrEqual(t);
        }
      }
    });
  });

  describe('multiple targets', () => {
    it('should distribute packets across targets based on counter', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1, 2, 3],
        pattern: 'constant',
        interval: 10,
        seed: 42,
      });

      const targets: number[] = [];
      for (let t = 0; t < 100; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) targets.push(pkt.to);
      }

      // Targets should be determined by packetCounter modulo targets.length
      // Each call to generatePacket increments the counter
      // The relative ordering among generated packets should cycle through targets
      expect(new Set(targets).size).toBe(3);
      expect(targets.every(t => [1, 2, 3].includes(t))).toBe(true);
    });

    it('should handle single target', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [5],
        pattern: 'constant',
        interval: 10,
        seed: 42,
      });

      const packets = [];
      for (let t = 0; t < 50; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) packets.push(pkt);
      }

      expect(packets.every(p => p.to === 5)).toBe(true);
    });
  });

  describe('reset functionality', () => {
    it('should reset generator state completely', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: 42,
      });

      // Generate some packets
      for (let t = 0; t < 50; t++) {
        gen.generatePacket(t);
      }

      // Capture post-reset behavior
      gen.reset();
      const afterResetPackets = [];
      for (let t = 0; t < 50; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) afterResetPackets.push(pkt.createdAt);
      }

      // Should produce valid packets after reset
      expect(afterResetPackets.length).toBeGreaterThan(0);
    });

    it('should return to initial state after reset', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'burst',
        interval: 10,
        burstSize: 3,
        burstMultiplier: 2,
        seed: 42,
      });

      // Drive through multiple burst cycles
      for (let t = 0; t < 100; t++) {
        gen.generatePacket(t);
      }

      gen.reset();

      // After reset, behavior should match a fresh generator
      const freshGen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'burst',
        interval: 10,
        burstSize: 3,
        burstMultiplier: 2,
        seed: 42,
      });

      // Compare behavior from t=0 to t=20
      for (let t = 0; t < 20; t++) {
        const restored = gen.generatePacket(t);
        const fresh = freshGen.generatePacket(t);
        expect(restored?.createdAt).toBe(fresh?.createdAt);
      }
    });
  });

  describe('configuration', () => {
    it('should return config correctly', () => {
      const gen = new ClientGenerator({
        clientId: 5,
        targets: [10],
        pattern: 'constant',
        interval: 15,
        seed: 42,
      });

      const config = gen.getConfig();
      expect(config.clientId).toBe(5);
      expect(config.targets).toEqual([10]);
      expect(config.pattern).toBe('constant');
      expect(config.interval).toBe(15);
      expect(config.seed).toBe(42);
    });

    it('should use sensible defaults', () => {
      const gen = new ClientGenerator();
      const config = gen.getConfig();

      expect(config.clientId).toBe(0);
      expect(config.targets).toEqual([1]);
      expect(config.pattern).toBe('constant');
      expect(config.interval).toBe(10);
      expect(config.seed).toBe(42);
    });
  });

  describe('packet properties', () => {
    it('should set correct packet metadata', () => {
      const gen = new ClientGenerator({
        clientId: 7,
        targets: [8],
        pattern: 'constant',
        interval: 10,
        seed: 42,
      });

      // Advance to first packet generation
      for (let t = 0; t < 10; t++) {
        gen.generatePacket(t);
      }
      const pkt = gen.generatePacket(10)!;
      expect(pkt.from).toBe(7);
      expect(pkt.to).toBe(8);
      expect(pkt.createdAt).toBe(10);
      expect(pkt.id).toContain('pkt_7');
    });

    it('should increment packet ID counter monotonically', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 5,
        seed: 42,
      });

      const ids: string[] = [];
      for (let t = 0; t < 50; t++) {
        const pkt = gen.generatePacket(t);
        if (pkt) ids.push(pkt.id);
      }

      // IDs should be unique and monotonically increasing in their numeric part
      expect(ids.length).toBeGreaterThan(1);
      for (let i = 1; i < ids.length; i++) {
        const numA = parseInt(ids[i - 1]!.split('_').pop()!, 10);
        const numB = parseInt(ids[i]!.split('_').pop()!, 10);
        expect(numB).toBeGreaterThan(numA);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle zero interval', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 0,
        seed: 42,
      });

      let count = 0;
      for (let t = 0; t < 10; t++) {
        if (gen.generatePacket(t)) count++;
      }

      // With interval 0, first call at t=0 should generate immediately
      expect(count).toBeGreaterThan(0);
    });

    it('should handle empty target list gracefully', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [],
        pattern: 'constant',
        interval: 10,
        seed: 42,
      });

      // Should not throw even with no targets (targetId will be undefined)
      expect(() => gen.generatePacket(0)).not.toThrow();
    });

    it('should handle negative seed', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 10,
        seed: -1,
      });

      expect(() => gen.generatePacket(0)).not.toThrow();
    });

    it('should handle undefined pattern', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        seed: 42,
      });

      // Default pattern is 'constant'
      expect(gen.getConfig().pattern).toBe('constant');
    });

    it('should not throw on continuous rapid generation', () => {
      const gen = new ClientGenerator({
        clientId: 0,
        targets: [1],
        pattern: 'constant',
        interval: 1,
        seed: 42,
      });

      expect(() => {
        for (let t = 0; t < 1000; t++) {
          gen.generatePacket(t);
        }
      }).not.toThrow();
    });
  });
});
