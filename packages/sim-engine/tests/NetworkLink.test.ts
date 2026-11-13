import { describe, it, expect } from 'vitest';
import { NetworkLink } from '../src/network/NetworkLink.ts';
import { createPacket } from '../src/network/Packet.ts';
import type { NetworkLinkConfig } from '../src/network/NetworkLink.ts';

describe('NetworkLink', () => {
  describe('basic connectivity', () => {
    it('should send packets successfully under normal conditions', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 10,
        seed: 42,
      });

      const packet = createPacket('pkt_1', 0, 1, { msg: 'hello' }, 0);
      const result = link.send(packet, 0);

      expect(result).not.toBeNull();
      expect(result!.delivered).toBe(false);
      expect(result!.estimatedArrival).toBeGreaterThanOrEqual(10);
      expect(result!.dropped).toBe(false);
    });

    it('should have correct source and destination', () => {
      const link = new NetworkLink(2, 3);
      expect(link.from).toBe(2);
      expect(link.to).toBe(3);
    });

    it('should use default configuration when none provided', () => {
      const link = new NetworkLink(0, 1);
      const config = link.getConfig();
      expect(config.baseLatency).toBe(10);
      expect(config.jitterRange).toBe(5);
      expect(config.packetLossPercentage).toBe(0);
      expect(config.partitioned).toBe(false);
    });
  });

  describe('packet loss', () => {
    it('should drop packets according to configured percentage', () => {
      // Test 100% loss
      const link = new NetworkLink(0, 1, {
        packetLossPercentage: 100,
        seed: 42,
      });

      const packet = createPacket('pkt_loss', 0, 1, {}, 0);
      const result = link.send(packet, 0);

      expect(result).toBeNull();
    });

    it('should never drop packets with 0% loss', () => {
      const link = new NetworkLink(0, 1, {
        packetLossPercentage: 0,
        seed: 42,
      });

      for (let i = 0; i < 10; i++) {
        const pkt = createPacket(`pkt_${i}`, 0, 1, {}, i * 10);
        const result = link.send(pkt, i * 10);
        expect(result).not.toBeNull();
        expect(result!.dropped).toBe(false);
      }
    });

    it('should mark dropped packets correctly', () => {
      const link = new NetworkLink(0, 1, {
        packetLossPercentage: 50,
        seed: 99,
      });

      const packet = createPacket('pkt_drop_test', 0, 1, {}, 0);
      const result = link.send(packet, 0);

      if (result) {
        expect(result.dropped).toBe(false);
      } else {
        // Packet was dropped during send
        expect(packet.dropped).toBe(true);
      }
    });
  });

  describe('partition injection and healing', () => {
    it('should drop all packets when partitioned', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        packetLossPercentage: 0,
        seed: 42,
      });

      // Send before partition
      const packet1 = createPacket('pkt_pre', 0, 1, {}, 0);
      const result1 = link.send(packet1, 0);
      expect(result1).not.toBeNull();

      // Partition the link
      link.setPartitioned(true);
      expect(link.isPartitioned()).toBe(true);

      // Send during partition
      const packet2 = createPacket('pkt_during', 0, 1, {}, 5);
      const result2 = link.send(packet2, 5);
      expect(result2).toBeNull();

      // Heal the link
      link.setPartitioned(false);
      expect(link.isPartitioned()).toBe(false);

      // Send after healing
      const packet3 = createPacket('pkt_post', 0, 1, {}, 10);
      const result3 = link.send(packet3, 10);
      expect(result3).not.toBeNull();
    });

    it('should allow toggling partition multiple times', () => {
      const link = new NetworkLink(0, 1, {
        packetLossPercentage: 0,
        seed: 42,
      });

      // Normal operation
      let packet = createPacket('pkt_1', 0, 1, {}, 0);
      expect(link.send(packet, 0)).not.toBeNull();

      // Partition
      link.setPartitioned(true);
      packet = createPacket('pkt_2', 0, 1, {}, 5);
      expect(link.send(packet, 5)).toBeNull();

      // Heal
      link.setPartitioned(false);
      packet = createPacket('pkt_3', 0, 1, {}, 10);
      expect(link.send(packet, 10)).not.toBeNull();

      // Re-partition
      link.setPartitioned(true);
      packet = createPacket('pkt_4', 0, 1, {}, 15);
      expect(link.send(packet, 15)).toBeNull();
    });

    it('should be idempotent when setting same partition state', () => {
      const link = new NetworkLink(0, 1);
      link.setPartitioned(true);
      link.setPartitioned(true);
      expect(link.isPartitioned()).toBe(true);

      link.setPartitioned(false);
      link.setPartitioned(false);
      expect(link.isPartitioned()).toBe(false);
    });
  });

  describe('jitter behavior', () => {
    it('should produce zero jitter when jitterRange is 0', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 42,
      });

      const packet = createPacket('pkt_jitter_zero', 0, 1, {}, 0);
      const result = link.send(packet, 0);

      expect(result).not.toBeNull();
      // With zero jitter and infinite bandwidth, arrival = baseLatency exactly
      expect(result!.estimatedArrival).toBe(10);
    });

    it('should bound uniform jitter within configured range', () => {
      const jitterRange = 5;
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange,
        jitterType: 'uniform',
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 42,
      });

      for (let i = 0; i < 100; i++) {
        const packet = createPacket(`pkt_uniform_${i}`, 0, 1, {}, i);
        const result = link.send(packet, i);
        expect(result).not.toBeNull();

        const delay = result!.estimatedArrival - i;
        // Delay = baseLatency + |jitter| where jitter ∈ [-range, +range]
        // So delay ∈ [baseLatency, baseLatency + range]
        expect(delay).toBeGreaterThanOrEqual(10);
        expect(delay).toBeLessThanOrEqual(10 + jitterRange);
      }
    });

    it('should produce gaussian-distributed jitter with reasonable bounds', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange: 10,
        jitterType: 'gaussian',
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 42,
      });

      const delays: number[] = [];
      for (let i = 0; i < 200; i++) {
        const packet = createPacket(`pkt_gauss_${i}`, 0, 1, {}, i);
        const result = link.send(packet, i);
        if (result) {
          // Record delay (arrival - creation time) not absolute arrival
          delays.push(result.estimatedArrival - i);
        }
      }

      // With std dev 10, most delays should fall within reasonable bounds
      // baseLatency + |gaussian| where gaussian ~ N(0, 10)
      // Mean delay ≈ 10 + E[|N(0,10)|] ≈ 10 + 8 = 18, but with seed-specific variance
      const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
      expect(mean).toBeGreaterThan(15);
      expect(mean).toBeLessThan(35);

      // Check distribution has positive variance (not all same value)
      const variance = delays.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / delays.length;
      expect(variance).toBeGreaterThan(30);
    });

    it('should produce deterministic jitter with same seed', () => {
      const link1 = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange: 5,
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 123,
      });

      const link2 = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange: 5,
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 123,
      });

      for (let i = 0; i < 10; i++) {
        const p1 = link1.send(createPacket(`d1_${i}`, 0, 1, {}, i), i);
        const p2 = link2.send(createPacket(`d2_${i}`, 0, 1, {}, i), i);
        expect(p1!.estimatedArrival - i).toBe(p2!.estimatedArrival - i);
      }
    });
  });

  describe('bandwidth and serialization', () => {
    it('should respect bandwidth limits during processing', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 1,
        seed: 42,
      });

      // Queue up multiple packets
      for (let i = 0; i < 5; i++) {
        const packet = createPacket(`pkt_bw_${i}`, 0, 1, {}, i * 5);
        link.send(packet, i * 5);
      }

      // Process at time 10 with bandwidth 1
      const processed = link.processPackets(10, 1);
      expect(processed.length).toBeLessThanOrEqual(1);
    });

    it('should deliver queued packets in order', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 10,
        seed: 42,
      });

      const packets = [
        createPacket('first', 0, 1, { seq: 1 }, 0),
        createPacket('second', 0, 1, { seq: 2 }, 5),
        createPacket('third', 0, 1, { seq: 3 }, 10),
      ];

      packets.forEach(p => link.send(p, p.createdAt));

      const delivered = link.processPackets(20, 10);
      expect(delivered.length).toBe(3);
      expect(delivered[0].data.seq).toBe(1);
      expect(delivered[1].data.seq).toBe(2);
      expect(delivered[2].data.seq).toBe(3);
    });

    it('should handle infinite bandwidth (no serialization delay)', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 42,
      });

      const packet = createPacket('pkt_inf', 0, 1, {}, 0);
      const result = link.send(packet, 0);

      expect(result).not.toBeNull();
      // Should arrive immediately after base latency
      expect(result!.estimatedArrival).toBe(10);
    });
  });

  describe('configuration updates', () => {
    it('should update configuration dynamically', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        packetLossPercentage: 0,
        seed: 42,
      });

      expect(link.getConfig().baseLatency).toBe(10);

      link.updateConfig({ baseLatency: 20 });
      expect(link.getConfig().baseLatency).toBe(20);

      link.updateConfig({ packetLossPercentage: 50 });
      expect(link.getConfig().packetLossPercentage).toBe(50);
    });

    it('should not mutate original config object', () => {
      const originalConfig: NetworkLinkConfig = {
        baseLatency: 10,
        jitterRange: 5,
        jitterType: 'uniform',
        packetLossPercentage: 0,
        bandwidth: 1,
        partitioned: false,
      };

      const link = new NetworkLink(0, 1, originalConfig);
      link.updateConfig({ baseLatency: 20 });

      expect(originalConfig.baseLatency).toBe(10);
      expect(link.getConfig().baseLatency).toBe(20);
    });
  });

  describe('edge cases', () => {
    it('should handle zero base latency', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 0,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 42,
      });

      const packet = createPacket('pkt_zero', 0, 1, {}, 0);
      const result = link.send(packet, 0);

      expect(result).not.toBeNull();
      expect(result!.estimatedArrival).toBe(0);
    });

    it('should clear pending packets', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 10,
        packetLossPercentage: 0,
        bandwidth: 10,
        seed: 42,
      });

      link.send(createPacket('pkt_clear1', 0, 1, {}, 0), 0);
      link.send(createPacket('pkt_clear2', 0, 1, {}, 5), 5);

      expect(link.pendingCount()).toBe(2);
      link.clearPending();
      expect(link.pendingCount()).toBe(0);
    });

    it('should handle negative latency gracefully', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: -5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 10,
        seed: 42,
      });

      const packet = createPacket('pkt_neg', 0, 1, {}, 10);
      const result = link.send(packet, 10);

      expect(result).not.toBeNull();
    });

    it('should queue packets for later delivery', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: Number.POSITIVE_INFINITY,
        seed: 42,
      });

      // Send packet that arrives at t=5
      const pkt = createPacket('queued', 0, 1, {}, 0);
      link.send(pkt, 0);
      expect(pkt.estimatedArrival).toBe(5);

      // Before arrival time, no packets delivered
      const early = link.processPackets(3, 1);
      expect(early).toHaveLength(0);

      // At arrival time, packet should be delivered
      const late = link.processPackets(5, 1);
      expect(late).toHaveLength(1);
      expect(late[0]!.id).toBe('queued');
      expect(late[0]!.delivered).toBe(true);
    });

    it('should process packets in FIFO order under low bandwidth', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 1,
        seed: 42,
      });

      // Queue 5 packets all arriving at similar times
      for (let i = 0; i < 5; i++) {
        const pkt = createPacket(`fifo_${i}`, 0, 1, { seq: i }, i * 0.1);
        link.send(pkt, i * 0.1);
      }

      // Process at t=6 - first packet (arrival=6) should be delivered
      const batch = link.processPackets(6, 1);
      expect(batch).toHaveLength(1);
      expect(batch[0]!.id).toBe('fifo_0');

      // Remaining should still be pending
      expect(link.pendingCount()).toBe(4);
    });

    it('should support changing bandwidth after creation', () => {
      const link = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 1,
        seed: 42,
      });

      link.updateConfig({ bandwidth: 10 });
      expect(link.getConfig().bandwidth).toBe(10);
    });

    it('should compute higher delay with lower bandwidth', () => {
      const linkHighBw = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 100,
        seed: 42,
      });

      const linkLowBw = new NetworkLink(0, 1, {
        baseLatency: 5,
        jitterRange: 0,
        packetLossPercentage: 0,
        bandwidth: 1,
        seed: 42,
      });

      const highArrival = linkHighBw.send(createPacket('h', 0, 1, {}, 0), 0)!
        .estimatedArrival;
      const lowArrival = linkLowBw.send(createPacket('l', 0, 1, {}, 0), 0)!
        .estimatedArrival;

      // Low bandwidth adds more serialization delay → later arrival
      expect(lowArrival).toBeGreaterThan(highArrival);
    });
  });
});
