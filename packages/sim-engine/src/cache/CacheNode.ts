/**
 * Cache node supporting multiple eviction policies with TTL support.
 */

export type EvictionPolicy = 'lru' | 'lfu';
export type CacheMode = 'cache-aside' | 'write-through';

export interface CacheConfig {
  /** Maximum number of entries in the cache */
  capacity: number;
  /** Default TTL in virtual time units (0 = no expiry) */
  defaultTtl?: number;
  /** Eviction policy to use */
  evictionPolicy?: EvictionPolicy;
  /** Cache operation mode */
  mode?: CacheMode;
}

const DEFAULT_CONFIG: Required<CacheConfig> = {
  capacity: 100,
  defaultTtl: 0,
  evictionPolicy: 'lru',
  mode: 'cache-aside',
};

export interface CacheEntry {
  key: string;
  value: unknown;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessedAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  puts: number;
  gets: number;
}

export class CacheNode {
  private readonly config: Required<CacheConfig>;
  private readonly entries = new Map<string, CacheEntry>();
  /** For LRU: track insertion/access order */
  private readonly accessOrder: string[] = [];
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
    puts: 0,
    gets: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<CacheConfig>;
  }

  getConfig(): Readonly<Required<CacheConfig>> {
    return { ...this.config };
  }

  getStats(): Readonly<CacheStats> {
    return { ...this.stats };
  }

  getSize(): number {
    return this.entries.size;
  }

  isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /**
   * Get a value from the cache.
   * Returns undefined on miss or expiration.
   */
  get(key: string, currentTime: number): unknown {
    this.stats.gets++;

    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (entry.expiresAt !== null && currentTime >= entry.expiresAt) {
      this.entries.delete(key);
      this.removeAccessOrder(key);
      this.stats.expirations++;
      this.stats.misses++;
      return undefined;
    }

    // Update access tracking
    entry.accessCount++;
    entry.lastAccessedAt = currentTime;
    this.updateAccessOrder(key);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Put a value into the cache.
   * In cache-aside mode, this simulates a cache fill after a miss.
   * In write-through mode, this also writes to backing store (tracked separately).
   */
  put(
    key: string,
    value: unknown,
    currentTime: number,
    ttl?: number
  ): void {
    this.stats.puts++;

    const entryTtl = ttl ?? this.config.defaultTtl;
    const expiresAt = entryTtl > 0 ? currentTime + entryTtl : null;

    // If key already exists, update it
    if (this.entries.has(key)) {
      const entry = this.entries.get(key)!;
      entry.value = value;
      entry.createdAt = currentTime;
      entry.expiresAt = expiresAt;
      entry.accessCount = 0;
      entry.lastAccessedAt = currentTime;
      this.updateAccessOrder(key);
      return;
    }

    // Evict if at capacity
    if (this.entries.size >= this.config.capacity) {
      this.evict(currentTime);
    }

    // Insert new entry
    const entry: CacheEntry = {
      key,
      value,
      createdAt: currentTime,
      expiresAt,
      accessCount: 0,
      lastAccessedAt: currentTime,
    };

    this.entries.set(key, entry);
    this.accessOrder.push(key);
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: string): boolean {
    const existed = this.entries.has(key);
    this.entries.delete(key);
    this.removeAccessOrder(key);
    return existed;
  }

  /**
   * Process TTL expirations at the given time.
   * Returns array of expired keys.
   */
  processExpirations(currentTime: number): string[] {
    const expired: string[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && currentTime >= entry.expiresAt) {
        expired.push(key);
      }
    }
    for (const key of expired) {
      this.entries.delete(key);
      this.removeAccessOrder(key);
      this.stats.expirations++;
    }
    return expired;
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.entries.clear();
    this.accessOrder.length = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      puts: 0,
      gets: 0,
    };
  }

  /**
   * Reset stats without clearing data.
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      puts: 0,
      gets: 0,
    };
  }

  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }

  // ── Private methods ────────────────────────────────────────────────

  private updateAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  private removeAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  private evict(currentTime: number): void {
    let evictKey: string | null = null;

    if (this.config.evictionPolicy === 'lfu') {
      evictKey = this.findLFUEviction(currentTime);
    } else {
      // LRU (default)
      evictKey = this.findLRUEviction(currentTime);
    }

    if (evictKey !== null) {
      this.entries.delete(evictKey);
      this.removeAccessOrder(evictKey);
      this.stats.evictions++;
    }
  }

  private findLRUEviction(currentTime: number): string | null {
    // First priority: expired entries
    for (const key of this.accessOrder) {
      const entry = this.entries.get(key);
      if (entry && entry.expiresAt !== null && currentTime >= entry.expiresAt) {
        return key;
      }
    }
    // Second priority: least recently used
    return this.accessOrder.length > 0 ? this.accessOrder[0] : null;
  }

  private findLFUEviction(currentTime: number): string | null {
    // First priority: expired entries
    for (const key of this.accessOrder) {
      const entry = this.entries.get(key);
      if (entry && entry.expiresAt !== null && currentTime >= entry.expiresAt) {
        return key;
      }
    }
    // Second priority: least frequently used
    let minCount = Infinity;
    let minKey: string | null = null;
    for (const key of this.accessOrder) {
      const entry = this.entries.get(key);
      if (entry && entry.accessCount < minCount) {
        minCount = entry.accessCount;
        minKey = key;
      }
    }
    // Tie-break by earliest access (LRU)
    if (minKey !== null) {
      const minEntry = this.entries.get(minKey)!;
      for (const key of this.accessOrder) {
        const entry = this.entries.get(key);
        if (
          entry &&
          entry.accessCount === minCount &&
          entry.lastAccessedAt < minEntry.lastAccessedAt
        ) {
          minKey = key;
        }
      }
    }
    return minKey;
  }
}
