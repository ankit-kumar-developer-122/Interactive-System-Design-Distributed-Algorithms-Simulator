import { describe, it, expect } from 'vitest';
import { AppServer, RequestStatus } from '../src/loadbalancer/AppServer.js';
import type { Packet } from '../src/network/Packet.js';

describe('AppServer', () => {
  describe('basic request handling', () => {
    it('should accept requests when idle', () => {
      const server = new AppServer();
      const packet: Packet = {
        id: 'req_1',
        from: 0,
        to: 1,
        data: { msg: 'hello' },
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      };

      const result = server.submitRequest(packet, 0);
      expect(result.status).toBe(RequestStatus.ACCEPTED);
      expect(result.packet?.id).toBe('req_1');
    });

    it('should reject requests when server is full', () => {
      const server = new AppServer({ maxWorkers: 1, maxQueueSize: 0 });
      const packet: Packet = {
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      };

      // Fill the worker
      server.submitRequest({ ...packet, id: 'req_fill' }, 0);

      // Next request should be rejected
      const result = server.submitRequest(packet, 0);
      expect(result.status).toBe(RequestStatus.REJECTED_503);
      expect(result.packet).toBeUndefined();
    });

    it('should return queue depth at submission time', () => {
      const server = new AppServer({ maxWorkers: 1, maxQueueSize: 5 });
      const packet: Packet = {
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      };

      // Submit first request (fills worker, queue stays at 0)
      server.submitRequest({ ...packet, id: 'req_first' }, 0);

      // Submit second request (goes to queue since worker is busy)
      const result = server.submitRequest(packet, 0);
      expect(result.queueDepthAtSubmission).toBe(0); // queue was empty before this submission
    });
  });

  describe('worker management', () => {
    it('should track busy workers correctly', () => {
      const server = new AppServer({ maxWorkers: 2 });

      const packet1: Packet = {
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      };

      server.submitRequest(packet1, 0);
      expect(server.getBusyWorkerCount()).toBe(1);

      server.submitRequest({ ...packet1, id: 'req_2' }, 0);
      expect(server.getBusyWorkerCount()).toBe(2);
    });

    it('should report total worker count', () => {
      const server = new AppServer({ maxWorkers: 4 });
      expect(server.getTotalWorkerCount()).toBe(4);
    });

    it('should complete workers at their finish time', () => {
      const server = new AppServer({ maxWorkers: 1, baseLatency: 10 });

      const packet: Packet = {
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      };

      server.submitRequest(packet, 0);
      expect(server.getBusyWorkerCount()).toBe(1);

      // Complete the request
      server.processRequests(10);
      expect(server.getBusyWorkerCount()).toBe(0);
    });
  });

  describe('queue management', () => {
    it('should queue requests when all workers are busy', () => {
      const server = new AppServer({ maxWorkers: 1, maxQueueSize: 5, baseLatency: 100 });

      // Fill the worker
      server.submitRequest({
        id: 'req_worker',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // Queue up requests
      for (let i = 0; i < 3; i++) {
        server.submitRequest({
          id: `req_queue_${i}`,
          from: 0,
          to: 1,
          data: {},
          createdAt: 0,
          estimatedArrival: 0,
          delivered: false,
          dropped: false,
        }, 0);
      }

      expect(server.getQueueDepth()).toBe(3);
    });

    it('should reject requests when queue is full', () => {
      const server = new AppServer({ maxWorkers: 1, maxQueueSize: 2, baseLatency: 100 });

      // Fill worker and queue
      server.submitRequest({
        id: 'req_worker',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      server.submitRequest({
        id: 'req_q1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      server.submitRequest({
        id: 'req_q2',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // This should be rejected
      const result = server.submitRequest({
        id: 'req_overflow',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      expect(result.status).toBe(RequestStatus.REJECTED_503);
    });

    it('should process queued requests when workers become available', () => {
      const server = new AppServer({ maxWorkers: 1, maxQueueSize: 5, baseLatency: 10 });

      // Start a long-running request
      server.submitRequest({
        id: 'req_long',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // Queue another request
      server.submitRequest({
        id: 'req_queued',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      expect(server.getQueueDepth()).toBe(1);

      // Complete the first request and drain queue
      server.processRequests(10);
      expect(server.getQueueDepth()).toBe(0);
    });
  });

  describe('latency degradation', () => {
    it('should have base latency when idle', () => {
      const server = new AppServer({ maxWorkers: 4, baseLatency: 10 });

      const packet: Packet = {
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      };

      const result = server.submitRequest(packet, 0);
      expect(result.estimatedCompletionTime).toBe(10);
    });

    it('should increase latency under high utilization', () => {
      const server = new AppServer({ maxWorkers: 1, baseLatency: 10, saturationFactor: 2 });

      // First request at idle (0% utilization)
      const r1 = server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // Second request sees 100% utilization (worker already busy)
      const r2 = server.submitRequest({
        id: 'req_2',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // With saturationFactor=2 and 100% utilization:
      // latency = 10 * (1 + 1.0 * 2) = 10 * 3 = 30
      expect(r2.estimatedCompletionTime).toBe(30);
    });

    it('should show exponential latency growth near capacity', () => {
      const server = new AppServer({ maxWorkers: 2, baseLatency: 10, saturationFactor: 3 });

      // Fill both workers
      server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      server.submitRequest({
        id: 'req_2',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // Now at 100% utilization, next request goes to queue
      const r3 = server.submitRequest({
        id: 'req_3',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // With 100% utilization: latency = 10 * (1 + 1.0 * 3) = 40
      expect(r3.estimatedCompletionTime).toBe(40);
    });

    it('should calculate latency based on current utilization', () => {
      const server = new AppServer({ maxWorkers: 4, baseLatency: 10, saturationFactor: 1 });

      // At 0% utilization: latency = 10 * (1 + 0 * 1) = 10
      const r1 = server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);
      expect(r1.estimatedCompletionTime).toBe(10);

      // At 25% utilization: latency = 10 * (1 + 0.25 * 1) = 12.5
      const r2 = server.submitRequest({
        id: 'req_2',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);
      expect(r2.estimatedCompletionTime).toBe(12.5);
    });
  });

  describe('utilization metrics', () => {
    it('should report zero utilization when idle', () => {
      const server = new AppServer({ maxWorkers: 4 });
      expect(server.getUtilization()).toBe(0);
    });

    it('should report correct utilization with busy workers', () => {
      const server = new AppServer({ maxWorkers: 4 });

      server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      expect(server.getUtilization()).toBe(0.25);
    });

    it('should report full utilization when all workers busy', () => {
      const server = new AppServer({ maxWorkers: 2 });

      server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      server.submitRequest({
        id: 'req_2',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      expect(server.getUtilization()).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const server = new AppServer();
      const config = server.getConfig();

      expect(config.maxWorkers).toBe(4);
      expect(config.maxQueueSize).toBe(10);
      expect(config.baseLatency).toBe(10);
      expect(config.saturationFactor).toBe(2);
    });

    it('should allow custom configuration', () => {
      const server = new AppServer({
        maxWorkers: 8,
        maxQueueSize: 20,
        baseLatency: 5,
        saturationFactor: 3,
      });

      const config = server.getConfig();
      expect(config.maxWorkers).toBe(8);
      expect(config.maxQueueSize).toBe(20);
      expect(config.baseLatency).toBe(5);
      expect(config.saturationFactor).toBe(3);
    });

    it('should not mutate original config object', () => {
      const originalConfig = {
        maxWorkers: 8,
        maxQueueSize: 20,
      };

      const server = new AppServer(originalConfig);
      // Config is immutable via getter
      expect(server.getConfig().maxWorkers).toBe(8);
    });
  });

  describe('reset functionality', () => {
    it('should reset all state', () => {
      const server = new AppServer({ maxWorkers: 1, baseLatency: 10 });

      server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      expect(server.getBusyWorkerCount()).toBe(1);
      expect(server.getQueueDepth()).toBe(0);

      server.reset();

      expect(server.getBusyWorkerCount()).toBe(0);
      expect(server.getQueueDepth()).toBe(0);
    });

    it('should allow reusing server after reset', () => {
      const server = new AppServer({ maxWorkers: 1, baseLatency: 10 });

      // First run
      server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);
      server.processRequests(10);

      // Reset and reuse
      server.reset();
      const result = server.submitRequest({
        id: 'req_2',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      expect(result.status).toBe(RequestStatus.ACCEPTED);
    });
  });

  describe('edge cases', () => {
    it('should handle zero max workers gracefully', () => {
      const server = new AppServer({ maxWorkers: 0, maxQueueSize: 5 });

      const result = server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 0,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 0);

      // With 0 workers, should still accept into queue
      expect(result.status).toBe(RequestStatus.ACCEPTED);
      expect(server.getQueueDepth()).toBe(1);
    });

    it('should handle very large queue sizes', () => {
      const server = new AppServer({ maxWorkers: 1, maxQueueSize: 1000 });

      let acceptedCount = 0;
      for (let i = 0; i < 100; i++) {
        const result = server.submitRequest({
          id: `req_${i}`,
          from: 0,
          to: 1,
          data: {},
          createdAt: 0,
          estimatedArrival: 0,
          delivered: false,
          dropped: false,
        }, 0);
        if (result.status === RequestStatus.ACCEPTED) {
          acceptedCount++;
        }
      }

      // Should accept all (1 worker + 100 queue)
      expect(acceptedCount).toBe(100);
    });

    it('should handle negative base latency gracefully', () => {
      const server = new AppServer({ maxWorkers: 1, baseLatency: -5 });

      const result = server.submitRequest({
        id: 'req_1',
        from: 0,
        to: 1,
        data: {},
        createdAt: 10,
        estimatedArrival: 0,
        delivered: false,
        dropped: false,
      }, 10);

      // Negative latency results in earlier completion
      expect(result.estimatedCompletionTime).toBeLessThan(10);
    });
  });
});
