import { describe, it, expect } from 'vitest';
import { CacheNode } from '../src/cache/CacheNode.js';
import type { CacheConfig } from '../src/cache/CacheNode.js';

describe('CacheNode', () => {
  describe('basic operations', () => {
    it('should start empty', () => {
      const cache = new CacheNode({ capacity: 10 });
      expect(cache.getSize()).toBe(0);
      expect(cache.isEmpty()).toBe(true);
    });

    it('should put and get values', () => {
      const cache = new CacheNode({ capacity: 10 });
      cache.put('key1', 'value1', 0);
      expect(cache.get('key1', 0)).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      const cache = new CacheNode({ capacity: 10 });
      expect(cache.get('missing', 0)).toBeUndefined();
    });

    it('should delete keys', () => {
      const cache = new CacheNode({ capacity: 10 });
      cache.put('key1', 'value1', 0);
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1', 0)).toBeUndefined();
      expect(cache.delete('missing')).toBe(false);
    });

    it('should clear all entries', () => {
      const cache = new CacheNode({ capacity: 10 });
      cache.put('key1', 'value1', 0);
      cache.put('key2', 'value2', 0);
      cache.clear();
      expect(cache.getSize()).toBe(0);
      expect(cache.get('key1', 0)).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entry when at capacity', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // Access 'a' to make it recently used
      cache.get('a', 0);

      // Insert 'd' - should evict 'b' (least recently used)
      cache.put('d', 4, 0);

      expect(cache.get('a', 0)).toBe(1);
      expect(cache.get('b', 0)).toBeUndefined();
      expect(cache.get('c', 0)).toBe(3);
      expect(cache.get('d', 0)).toBe(4);
    });

    it('should evict in insertion order when no accesses', () => {
      const cache = new CacheNode({ capacity: 2, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      expect(cache.get('a', 0)).toBeUndefined();
      expect(cache.get('b', 0)).toBe(2);
      expect(cache.get('c', 0)).toBe(3);
    });

    it('should update access order on get', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // Access 'a' twice
      cache.get('a', 0);
      cache.get('a', 1);

      // Insert 'd' - should evict 'b' (least recently used after 'a' access)
      cache.put('d', 4, 1);

      expect(cache.get('a', 1)).toBe(1);
      expect(cache.get('b', 1)).toBeUndefined();
    });

    it('should update access order on put to existing key', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // Update 'a'
      cache.put('a', 'new_a', 1);

      // Insert 'd' - should evict 'b'
      cache.put('d', 4, 1);

      expect(cache.get('a', 1)).toBe('new_a');
      expect(cache.get('b', 1)).toBeUndefined();
      expect(cache.get('c', 1)).toBe(3);
    });
  });

  describe('LFU eviction', () => {
    it('should evict least frequently used entry when at capacity', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lfu' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // Access 'a' multiple times
      cache.get('a', 0);
      cache.get('a', 1);
      cache.get('a', 2);

      // Insert 'd' - should evict 'b' or 'c' (both have count 0)
      cache.put('d', 4, 3);

      expect(cache.get('a', 3)).toBe(1);
      // Either b or c should be evicted (both have same freq)
      expect(cache.get('b', 3) !== undefined || cache.get('c', 3) !== undefined).toBe(true);
    });

    it(' should prefer LRU as tie-breaker for LFU', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lfu' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 1);
      cache.put('c', 3, 2);

      // All have accessCount 0, so 'a' should be evicted (least recently used)
      cache.put('d', 4, 3);

      expect(cache.get('a', 3)).toBeUndefined();
      expect(cache.get('b', 3)).toBe(2);
      expect(cache.get('c', 3)).toBe(3);
    });

    it('should not evict highly accessed entries', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lfu' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // Access 'a' many times
      for (let i = 0; i < 10; i++) {
        cache.get('a', i);
      }

      // Insert 'd' - should evict either 'b' or 'c' (lowest frequency)
      cache.put('d', 4, 10);

      expect(cache.get('a', 10)).toBe(1);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      const cache = new CacheNode({ capacity: 10, defaultTtl: 5 });

      cache.put('key1', 'value1', 0);
      expect(cache.get('key1', 3)).toBe('value1');
      expect(cache.get('key1', 5)).toBeUndefined();
    });

    it('should not expire entries with zero TTL', () => {
      const cache = new CacheNode({ capacity: 10, defaultTtl: 0 });

      cache.put('key1', 'value1', 0);
      expect(cache.get('key1', 1000)).toBe('value1');
    });

    it('should allow per-entry TTL override', () => {
      const cache = new CacheNode({ capacity: 10, defaultTtl: 100 });

      cache.put('key1', 'value1', 0, 5);
      expect(cache.get('key1', 3)).toBe('value1');
      expect(cache.get('key1', 5)).toBeUndefined();
    });

    it('should process expirations with processExpirations', () => {
      const cache = new CacheNode({ capacity: 10, defaultTtl: 5 });

      cache.put('key1', 'value1', 0);
      cache.put('key2', 'value2', 0);
      cache.put('key3', 'value3', 3);

      const expired = cache.processExpirations(5);
      expect(expired).toContain('key1');
      expect(expired).toContain('key2');
      expect(expired).not.toContain('key3');
      expect(cache.getSize()).toBe(1);
    });

    it('should prioritize expired entries during eviction', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // 'a' expires at time 5 (explicitly set)
      cache.put('a', 1, 0, 5);

      // At time 10, 'a' is expired but b and c are still valid
      cache.processExpirations(10);

      // Now insert 'd' - should not need to evict since 'a' was already removed
      cache.put('d', 4, 10);
      expect(cache.getSize()).toBe(3);
    });
  });

  describe('cache modes', () => {
    it('should support cache-aside mode (default)', () => {
      const cache = new CacheNode({ capacity: 10, mode: 'cache-aside' });
      cache.put('key1', 'value1', 0);
      expect(cache.get('key1', 0)).toBe('value1');
    });

    it('should support write-through mode', () => {
      const cache = new CacheNode({ capacity: 10, mode: 'write-through' });
      cache.put('key1', 'value1', 0);
      expect(cache.get('key1', 0)).toBe('value1');
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      const cache = new CacheNode({ capacity: 10 });

      cache.put('key1', 'value1', 0);
      cache.get('key1', 0); // hit
      cache.get('missing', 0); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.gets).toBe(2);
    });

    it('should track evictions', () => {
      const cache = new CacheNode({ capacity: 2, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0); // should evict 'a'

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should track expirations', () => {
      const cache = new CacheNode({ capacity: 10, defaultTtl: 5 });

      cache.put('key1', 'value1', 0);
      cache.get('key1', 10); // causes expiration

      const stats = cache.getStats();
      expect(stats.expirations).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      const cache = new CacheNode({ capacity: 10 });

      cache.put('key1', 'value1', 0);
      cache.get('key1', 0); // hit
      cache.get('key2', 0); // miss

      expect(cache.getHitRate()).toBeCloseTo(0.5);
    });

    it('should reset stats without clearing data', () => {
      const cache = new CacheNode({ capacity: 10 });

      cache.put('key1', 'value1', 0);
      cache.get('key1', 0);

      cache.resetStats();
      expect(cache.getStats().hits).toBe(0);
      expect(cache.get('key1', 0)).toBe('value1');
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const cache = new CacheNode();
      const config = cache.getConfig();
      expect(config.capacity).toBe(100);
      expect(config.defaultTtl).toBe(0);
      expect(config.evictionPolicy).toBe('lru');
      expect(config.mode).toBe('cache-aside');
    });

    it('should allow custom configuration', () => {
      const config: CacheConfig = {
        capacity: 50,
        defaultTtl: 10,
        evictionPolicy: 'lfu',
        mode: 'write-through',
      };
      const cache = new CacheNode(config);
      const retrieved = cache.getConfig();
      expect(retrieved.capacity).toBe(50);
      expect(retrieved.defaultTtl).toBe(10);
      expect(retrieved.evictionPolicy).toBe('lfu');
      expect(retrieved.mode).toBe('write-through');
    });
  });

  describe('edge cases', () => {
    it('should handle capacity of 1', () => {
      const cache = new CacheNode({ capacity: 1, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);

      expect(cache.get('a', 0)).toBeUndefined();
      expect(cache.get('b', 0)).toBe(2);
    });

    it('should handle large number of operations', () => {
      const cache = new CacheNode({ capacity: 100, evictionPolicy: 'lru' });

      for (let i = 0; i < 1000; i++) {
        cache.put(`key${i}`, i, i);
      }

      // Should only keep last 100 entries
      expect(cache.getSize()).toBe(100);
      expect(cache.get('key999', 1000)).toBe(999);
      expect(cache.get('key900', 1000)).toBe(900);
      expect(cache.get('key899', 1000)).toBeUndefined();
    });

    it('should handle overwriting existing keys', () => {
      const cache = new CacheNode({ capacity: 3, evictionPolicy: 'lru' });

      cache.put('a', 1, 0);
      cache.put('b', 2, 0);
      cache.put('c', 3, 0);

      // Overwrite 'a'
      cache.put('a', 'new_a', 1);

      // Size should still be 3
      expect(cache.getSize()).toBe(3);
      expect(cache.get('a', 1)).toBe('new_a');
    });
  });
});
