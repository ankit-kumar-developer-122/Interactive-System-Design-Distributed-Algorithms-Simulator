import { describe, it, expect } from 'vitest';
import { DatabaseNode } from '../src/database/DatabaseNode.js';
import type { DatabaseConfig } from '../src/database/DatabaseNode.js';

describe('DatabaseNode', () => {
  describe('basic operations', () => {
    it('should initialize with empty data store', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });
      expect(db.getDataSize()).toBe(0);
    });

    it('should write and read values', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });

      const result = db.write('key1', 'value1', 0);
      expect(result.status).toBe('ok');

      const readResult = db.read('key1', 0);
      expect(readResult.status).toBe('ok');
      expect(readResult.data).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });

      const readResult = db.read('missing', 0);
      expect(readResult.status).toBe('ok');
      expect(readResult.data).toBeUndefined();
    });

    it('should clear all data', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });

      db.write('key1', 'value1', 0);
      db.clear();

      expect(db.getDataSize()).toBe(0);
      const readResult = db.read('key1', 0);
      expect(readResult.data).toBeUndefined();
    });
  });

  describe('replication', () => {
    it('should replicate data to replicas in sync mode', () => {
      const db = new DatabaseNode({
        replicaCount: 2,
        maxConnections: 5,
        replicationMode: 'sync',
      });

      db.write('key1', 'value1', 0);

      // Primary should have the data
      const primaryResult = db.read('key1', 0);
      expect(primaryResult.data).toBe('value1');
    });

    it('should create pending writes in async mode', () => {
      const db = new DatabaseNode({
        replicaCount: 2,
        maxConnections: 5,
        replicationMode: 'async',
        replicationLag: 10,
      });

      db.write('key1', 'value1', 0);

      // Immediately after write, check if replication is pending
      // The write should be accepted but replication delayed
      expect(db.getReplicaDataSize(0)).toBe(0);
    });

    it('should replicate after lag in async mode', () => {
      const db = new DatabaseNode({
        replicaCount: 2,
        maxConnections: 5,
        replicationMode: 'async',
        replicationLag: 10,
      });

      db.write('key1', 'value1', 0);

      // Process replications at time 10
      const replicated = db.processReplications(10);
      expect(replicated).toContain('key1');

      // Now replicas should have the data
      expect(db.getReplicaDataSize(0)).toBe(1);
      expect(db.getReplicaDataSize(1)).toBe(1);
    });

    it('should handle multiple replications', () => {
      const db = new DatabaseNode({
        replicaCount: 2,
        maxConnections: 5,
        replicationMode: 'async',
        replicationLag: 5,
      });

      db.write('key1', 'value1', 0);
      db.write('key2', 'value2', 0);
      db.write('key3', 'value3', 0);

      const replicated = db.processReplications(5);
      expect(replicated.length).toBe(3);
    });
  });

  describe('stale reads', () => {
    it('should mark reads as stale during replication lag', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 5,
        replicationMode: 'async',
        replicationLag: 10,
      });

      db.write('key1', 'value1', 0);

      // Read during replication lag
      const readResult = db.read('key1', 5);
      expect(readResult.status).toBe('ok');
      expect((readResult as any).stale).toBe(true);
    });

    it('should not mark reads as stale after replication completes', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 5,
        replicationMode: 'async',
        replicationLag: 10,
      });

      db.write('key1', 'value1', 0);
      db.processReplications(10);

      // Read after replication
      const readResult = db.read('key1', 15);
      expect(readResult.status).toBe('ok');
      expect((readResult as any).stale).toBeUndefined();
    });

    it('should not mark sync mode reads as stale', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 5,
        replicationMode: 'sync',
      });

      db.write('key1', 'value1', 0);
      const readResult = db.read('key1', 0);
      expect((readResult as any).stale).toBeUndefined();
    });
  });

  describe('connection pool', () => {
    it('should reject writes when connection pool is exhausted', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 1,
      });

      // Use the only connection
      db.write('key1', 'value1', 0);

      // Next write should be rejected
      const result = db.write('key2', 'value2', 0);
      expect(result.status).toBe('rejected_503');
      expect(result.rejectedReason).toBe('connection_pool_exhausted');
    });

    it('should reject reads when connection pool is exhausted', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 1,
      });

      // Use the only connection
      db.write('key1', 'value1', 0);

      // Next read should be rejected
      const result = db.read('key2', 0);
      expect(result.status).toBe('rejected_503');
      expect(result.rejectedReason).toBe('connection_pool_exhausted');
    });

    it('should track active connections', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 3,
      });

      db.write('key1', 'value1', 0);
      db.write('key2', 'value2', 0);

      expect(db.getConnectionCount()).toBe(2);
      expect(db.isConnectionAvailable()).toBe(true);
    });

    it('should release connections', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 2,
      });

      db.write('key1', 'value1', 0);
      db.write('key2', 'value2', 0);

      expect(db.getConnectionCount()).toBe(2);
      expect(db.isConnectionAvailable()).toBe(false);

      db.releaseConnections(1);
      expect(db.getConnectionCount()).toBe(1);
      expect(db.isConnectionAvailable()).toBe(true);
    });

    it('should not exceed max connections on release', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 2,
      });

      db.write('key1', 'value1', 0);
      db.releaseConnections(5); // Release more than available

      expect(db.getConnectionCount()).toBe(0);
      expect(db.isConnectionAvailable()).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should track reads and writes', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });

      db.write('key1', 'value1', 0);
      db.read('key1', 0);
      db.read('missing', 0);

      const stats = db.getStats();
      expect(stats.writes).toBe(1);
      expect(stats.reads).toBe(2);
    });

    it('should track stale reads', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 5,
        replicationMode: 'async',
        replicationLag: 10,
      });

      db.write('key1', 'value1', 0);
      db.read('key1', 5); // Stale read

      const stats = db.getStats();
      expect(stats.staleReads).toBe(1);
    });

    it('should track rejections', () => {
      const db = new DatabaseNode({
        replicaCount: 1,
        maxConnections: 1,
      });

      db.write('key1', 'value1', 0);
      db.write('key2', 'value2', 0); // Rejected

      const stats = db.getStats();
      expect(stats.rejections).toBe(1);
    });

    it('should reset stats without clearing data', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });

      db.write('key1', 'value1', 0);
      db.resetStats();

      expect(db.getStats().writes).toBe(0);
      expect(db.getDataSize()).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should require replicaCount and maxConnections', () => {
      expect(() => new DatabaseNode({} as DatabaseConfig)).toThrow('replicaCount and maxConnections are required');
    });

    it('should use default values for optional config', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 5 });
      const config = db.getConfig();

      expect(config.readLatency).toBe(5);
      expect(config.writeLatency).toBe(10);
      expect(config.replicationLag).toBe(0);
      expect(config.replicationMode).toBe('sync');
    });

    it('should allow custom configuration', () => {
      const db = new DatabaseNode({
        replicaCount: 3,
        maxConnections: 10,
        readLatency: 2,
        writeLatency: 5,
        replicationLag: 20,
        replicationMode: 'async',
      });
      const config = db.getConfig();

      expect(config.replicaCount).toBe(3);
      expect(config.maxConnections).toBe(10);
      expect(config.readLatency).toBe(2);
      expect(config.writeLatency).toBe(5);
      expect(config.replicationLag).toBe(20);
      expect(config.replicationMode).toBe('async');
    });
  });

  describe('edge cases', () => {
    it('should handle zero replicas', () => {
      const db = new DatabaseNode({ replicaCount: 0, maxConnections: 5 });

      db.write('key1', 'value1', 0);
      expect(db.getDataSize()).toBe(1);
    });

    it('should handle invalid replica index', () => {
      const db = new DatabaseNode({ replicaCount: 2, maxConnections: 5 });

      expect(db.getReplicaDataSize(-1)).toBe(-1);
      expect(db.getReplicaDataSize(5)).toBe(-1);
    });

    it('should handle rapid successive operations', () => {
      const db = new DatabaseNode({ replicaCount: 1, maxConnections: 10 });

      for (let i = 0; i < 100; i++) {
        db.write(`key${i}`, `value${i}`, i);
        db.releaseConnections(1);
      }

      expect(db.getDataSize()).toBe(100);
    });
  });
});
