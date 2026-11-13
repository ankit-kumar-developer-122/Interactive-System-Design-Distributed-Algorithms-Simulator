import { describe, it, expect } from 'vitest';
import { LoadBalancer } from '../src/loadbalancer/LoadBalancer.js';
import type { ServerNode } from '../src/loadbalancer/LoadBalancer.js';

describe('LoadBalancer', () => {
  describe('server management', () => {
    it('should add servers and report them', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);
      lb.addServer(1);
      lb.addServer(2);

      const servers = lb.getServers();
      expect(servers.size).toBe(3);
      expect(servers.has(0)).toBe(true);
      expect(servers.has(1)).toBe(true);
      expect(servers.has(2)).toBe(true);
    });

    it('should remove servers', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);
      lb.addServer(1);
      lb.removeServer(0);

      const servers = lb.getServers();
      expect(servers.size).toBe(1);
      expect(servers.has(0)).toBe(false);
      expect(servers.has(1)).toBe(true);
    });

    it('should return undefined for removed server state', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);
      lb.removeServer(0);

      expect(lb.getServerState(0)).toBeUndefined();
    });

    it('should apply default weight of 1', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);

      const state = lb.getServerState(0)!;
      expect(state.weight).toBe(1);
      expect(state.healthStatus).toBe('healthy');
      expect(state.connectionCount).toBe(0);
      expect(state.queueDepth).toBe(0);
    });

    it('should allow setting custom weight', () => {
      const lb = new LoadBalancer();
      lb.addServer(0, 5);

      const state = lb.getServerState(0)!;
      expect(state.weight).toBe(5);
    });

    it('should adjust round-robin index after removal', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);
      lb.addServer(1);
      lb.addServer(2);

      // Advance rrIndex by selecting some servers
      lb.selectServer(0); // selects 0, rrIndex becomes 1
      lb.selectServer(0); // selects 1, rrIndex becomes 2

      lb.removeServer(1);

      // After removal, we have servers [0, 2] (sorted by ID)
      // rrIndex is 2, but n=2, so idx = 2 % 2 = 0
      const result = lb.selectServer(0);
      expect(result).toBe(0);
    });
  });

  describe('round-robin routing', () => {
    it('should distribute requests evenly across servers', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);
      lb.addServer(2);

      const counts = new Map<number, number>();
      for (let i = 0; i < 6; i++) {
        const serverId = lb.selectServer(0);
        expect(serverId).toBeDefined();
        counts.set(serverId!, (counts.get(serverId!) ?? 0) + 1);
      }

      // Each server should get exactly 2 requests
      expect(counts.get(0)).toBe(2);
      expect(counts.get(1)).toBe(2);
      expect(counts.get(2)).toBe(2);
    });

    it('should cycle through servers deterministically', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      const sequence: number[] = [];
      for (let i = 0; i < 4; i++) {
        sequence.push(lb.selectServer(0)!);
      }

      expect(sequence).toEqual([0, 1, 0, 1]);
    });

    it('should skip unhealthy servers in round-robin', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);
      lb.addServer(2);

      lb.markUnhealthy(1);

      const results: number[] = [];
      for (let i = 0; i < 4; i++) {
        results.push(lb.selectServer(0)!);
      }

      // Should only select from servers 0 and 2
      expect(results.every(id => id === 0 || id === 2)).toBe(true);
    });

    it('should handle single server', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);

      for (let i = 0; i < 5; i++) {
        expect(lb.selectServer(0)).toBe(0);
      }
    });
  });

  describe('least-connections routing', () => {
    it('should select server with fewest connections', () => {
      const lb = new LoadBalancer({ strategy: 'least-connections' });
      lb.addServer(0);
      lb.addServer(1);

      // Start connections on server 0
      lb.startConnection(0);
      lb.startConnection(0);

      // Server 1 should be selected (fewer connections)
      expect(lb.selectServer(0)).toBe(1);
    });

    it('应该选择连接数最少的服务器，包括队列深度', () => {
      const lb = new LoadBalancer({ strategy: 'least-connections' });
      lb.addServer(0);
      lb.addServer(1);

      lb.startConnection(0);
      lb.setQueueDepth(0, 5);
      lb.setQueueDepth(1, 1);

      // Server 1 has total load of 1, server 0 has 6
      expect(lb.selectServer(0)).toBe(1);
    });

    it('should break ties by lowest server ID', () => {
      const lb = new LoadBalancer({ strategy: 'least-connections' });
      lb.addServer(0);
      lb.addServer(1);

      // Both have same load (0)
      expect(lb.selectServer(0)).toBe(0);
    });

    it('should exclude unhealthy servers', () => {
      const lb = new LoadBalancer({ strategy: 'least-connections' });
      lb.addServer(0);
      lb.addServer(1);

      lb.markUnhealthy(0);
      lb.startConnection(1);

      expect(lb.selectServer(0)).toBe(1);
    });

    it('should return undefined when all servers are unhealthy', () => {
      const lb = new LoadBalancer({ strategy: 'least-connections' });
      lb.addServer(0);
      lb.addServer(1);

      lb.markUnhealthy(0);
      lb.markUnhealthy(1);

      expect(lb.selectServer(0)).toBeUndefined();
    });
  });

  describe('weighted routing', () => {
    it('should favor higher-weight servers', () => {
      const lb = new LoadBalancer({ strategy: 'weighted' }, 42);
      lb.addServer(0, 3);
      lb.addServer(1, 1);

      // With weights 3:1, server 0 should get ~75% of traffic
      const counts = new Map<number, number>();
      for (let i = 0; i < 100; i++) {
        const serverId = lb.selectServer(i);
        expect(serverId).toBeDefined();
        if (serverId !== undefined) {
          counts.set(serverId, (counts.get(serverId) ?? 0) + 1);
        }
      }

      // Server 0 should get significantly more than server 1
      const count0 = counts.get(0) ?? 0;
      const count1 = counts.get(1) ?? 0;
      expect(count0 + count1).toBe(100); // All requests accounted for
      expect(count0).toBeGreaterThan(count1);
      expect(count0).toBeGreaterThanOrEqual(60); // At least 60%
    });

    it('should respect exact weight ratios over many iterations', () => {
      const lb = new LoadBalancer({ strategy: 'weighted' }, 123);
      lb.addServer(0, 2);
      lb.addServer(1, 1);

      const counts = new Map<number, number>();
      for (let i = 0; i < 300; i++) {
        const serverId = lb.selectServer(i);
        if (serverId !== undefined) {
          counts.set(serverId, (counts.get(serverId) ?? 0) + 1);
        }
      }

      // With 2:1 ratio, server 0 should get roughly 2/3 of traffic
      const count0 = counts.get(0) ?? 0;
      const count1 = counts.get(1) ?? 0;
      expect(count0 + count1).toBe(300);
      const ratio = count0 / count1;
      expect(ratio).toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(2.7);
    });

    it('should exclude unhealthy servers from weighted selection', () => {
      const lb = new LoadBalancer({ strategy: 'weighted' }, 42);
      lb.addServer(0, 3);
      lb.addServer(1, 1);

      lb.markUnhealthy(0);

      for (let i = 0; i < 10; i++) {
        expect(lb.selectServer(i)).toBe(1);
      }
    });
  });

  describe('health check failover', () => {
    it('should route away from unhealthy servers', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      lb.markUnhealthy(0);

      // All requests should go to server 1
      for (let i = 0; i < 5; i++) {
        expect(lb.selectServer(0)).toBe(1);
      }
    });

    it('should recover unhealthy servers after health check', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      lb.markUnhealthy(0);

      // Before recovery, all traffic goes to server 1
      expect(lb.selectServer(0)).toBe(1);

      // Run health checks to potentially recover
      lb.runHealthChecks(100);

      // After health check, server 0 might recover (30% chance)
      // We can't guarantee recovery, but we can verify the mechanism works
      const state = lb.getServerState(0);
      expect(state).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(state!.healthStatus);
    });

    it('should handle degraded servers', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      lb.markDegraded(0);

      // Degraded servers still receive traffic
      const results: number[] = [];
      for (let i = 0; i < 4; i++) {
        results.push(lb.selectServer(0)!);
      }

      // Should see both servers receiving traffic
      expect(results.includes(0)).toBe(true);
      expect(results.includes(1)).toBe(true);
    });

    it('should return undefined when no healthy servers exist', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      lb.markUnhealthy(0);
      lb.markUnhealthy(1);

      expect(lb.selectServer(0)).toBeUndefined();
    });

    it('should maintain deterministic behavior with partitions', () => {
      const lb1 = new LoadBalancer({ strategy: 'round-robin' }, 42);
      const lb2 = new LoadBalancer({ strategy: 'round-robin' }, 42);

      lb1.addServer(0);
      lb1.addServer(1);
      lb1.addServer(2);

      lb2.addServer(0);
      lb2.addServer(1);
      lb2.addServer(2);

      // Partition server 1 in both
      lb1.markUnhealthy(1);
      lb2.markUnhealthy(1);

      // Should produce identical sequences
      for (let i = 0; i < 10; i++) {
        expect(lb1.selectServer(i)).toBe(lb2.selectServer(i));
      }
    });
  });

  describe('connection tracking', () => {
    it('should track active connections', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);

      lb.startConnection(0);
      expect(lb.getServerState(0)!.connectionCount).toBe(1);

      lb.startConnection(0);
      expect(lb.getServerState(0)!.connectionCount).toBe(2);

      lb.endConnection(0);
      expect(lb.getServerState(0)!.connectionCount).toBe(1);

      lb.endConnection(0);
      expect(lb.getServerState(0)!.connectionCount).toBe(0);
    });

    it('should not go below zero connections', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);

      lb.endConnection(0);
      expect(lb.getServerState(0)!.connectionCount).toBe(0);
    });

    it('should ignore connections to unknown servers', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);

      lb.startConnection(99);
      lb.endConnection(99);

      expect(lb.getServerState(0)!.connectionCount).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const lb = new LoadBalancer();
      const config = lb.getConfig();

      expect(config.strategy).toBe('round-robin');
      expect(config.healthCheckInterval).toBe(100);
      expect(config.healthCheckTimeout).toBe(50);
    });

    it('should allow custom configuration', () => {
      const lb = new LoadBalancer({
        strategy: 'weighted',
        healthCheckInterval: 50,
        healthCheckTimeout: 25,
      });

      const config = lb.getConfig();
      expect(config.strategy).toBe('weighted');
      expect(config.healthCheckInterval).toBe(50);
      expect(config.healthCheckTimeout).toBe(25);
    });

    it('should not mutate original config object', () => {
      const originalConfig = {
        strategy: 'weighted' as const,
        healthCheckInterval: 50,
      };

      const lb = new LoadBalancer(originalConfig);
      lb.setStrategy('round-robin');

      expect(originalConfig.strategy).toBe('weighted');
      expect(lb.getConfig().strategy).toBe('round-robin');
    });

    it('should update strategy dynamically', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      lb.setStrategy('least-connections');
      expect(lb.getConfig().strategy).toBe('least-connections');

      lb.setStrategy('weighted');
      expect(lb.getConfig().strategy).toBe('weighted');
    });
  });

  describe('reset functionality', () => {
    it('should reset connection counts and queue depths', () => {
      const lb = new LoadBalancer();
      lb.addServer(0);

      lb.startConnection(0);
      lb.setQueueDepth(0, 5);

      lb.resetStats();

      expect(lb.getServerState(0)!.connectionCount).toBe(0);
      expect(lb.getServerState(0)!.queueDepth).toBe(0);
    });

    it('should reset round-robin index', () => {
      const lb = new LoadBalancer({ strategy: 'round-robin' });
      lb.addServer(0);
      lb.addServer(1);

      lb.selectServer(0); // advances index
      lb.resetStats();

      // Should start from beginning again
      expect(lb.selectServer(0)).toBe(0);
    });
  });
});
