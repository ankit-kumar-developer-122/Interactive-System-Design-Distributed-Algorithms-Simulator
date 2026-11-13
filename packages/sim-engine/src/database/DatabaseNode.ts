/**
 * Database node supporting primary-replica topology with configurable replication lag.
 */

export type ReplicaMode = 'sync' | 'async';
export type ConnectionStatus = 'idle' | 'busy' | 'available';

export interface DatabaseConfig {
  /** Number of replicas */
  replicaCount: number;
  /** Read latency in virtual time units */
  readLatency: number;
  /** Write latency in virtual time units */
  writeLatency: number;
  /** Replication lag in virtual time units (async mode only) */
  replicationLag?: number;
  /** Maximum concurrent connections */
  maxConnections: number;
  /** Replication mode */
  replicationMode?: ReplicaMode;
}

const DEFAULT_CONFIG: Omit<DatabaseConfig, 'replicaCount' | 'maxConnections'> = {
  readLatency: 5,
  writeLatency: 10,
  replicationLag: 0,
  replicationMode: 'sync',
};

export interface RequestResult {
  status: 'ok' | 'error' | 'rejected_503';
  data?: unknown;
  rejectedReason?: string;
  readTimestamp?: number;
  writeTimestamp?: number;
}

export interface DBStats {
  reads: number;
  writes: number;
  staleReads: number;
  rejections: number;
  activeConnections: number;
}

export class DatabaseNode {
  private readonly config: Required<DatabaseConfig>;
  /** Primary data store */
  private readonly data = new Map<string, { value: unknown; committedAt: number }>();
  /** Replica state (may be behind primary due to replication lag) */
  private readonly replicas: Array<Map<string, { value: unknown; committedAt: number }>>;
  /** Pending writes waiting for replication */
  private readonly pendingWrites: Array<{ key: string; value: unknown; committedAt: number; readyAt: number }> = [];
  /** Available connections */
  private availableConnections: number;
  private stats: DBStats = {
    reads: 0,
    writes: 0,
    staleReads: 0,
    rejections: 0,
    activeConnections: 0,
  };

  constructor(config: Partial<DatabaseConfig>) {
    if (config.replicaCount === undefined || config.maxConnections === undefined) {
      throw new Error('replicaCount and maxConnections are required');
    }
    const resolvedConfig = { ...DEFAULT_CONFIG, ...config } as Required<DatabaseConfig>;
    this.config = resolvedConfig;
    this.availableConnections = config.maxConnections!;
    this.replicas = Array.from({ length: config.replicaCount! }, () => new Map());
  }

  getConfig(): Readonly<Required<DatabaseConfig>> {
    return { ...this.config };
  }

  getStats(): Readonly<DBStats> {
    return { ...this.stats };
  }

  getDataSize(): number {
    return this.data.size;
  }

  getReplicaDataSize(index: number): number {
    if (index < 0 || index >= this.replicas.length) {
      return -1;
    }
    return this.replicas[index].size;
  }

  getConnectionCount(): number {
    return this.config.maxConnections - this.availableConnections;
  }

  isConnectionAvailable(): boolean {
    return this.availableConnections > 0;
  }

  /**
   * Write a value to the primary.
   * In sync mode, replica updates immediately.
   * In async mode, write is queued for replication after lag.
   */
  write(
    key: string,
    value: unknown,
    currentTime: number
  ): RequestResult {
    this.stats.writes++;

    if (this.availableConnections <= 0) {
      this.stats.rejections++;
      return {
        status: 'rejected_503',
        rejectedReason: 'connection_pool_exhausted',
      };
    }

    this.availableConnections--;
    this.stats.activeConnections = this.config.maxConnections - this.availableConnections;

    // Write to primary
    this.data.set(key, { value, committedAt: currentTime });

    const writeTimestamp = currentTime + this.config.writeLatency;

    if (this.config.replicationMode === 'sync') {
      // Immediately replicate to all replicas
      for (const replica of this.replicas) {
        replica.set(key, { value, committedAt: currentTime });
      }
    } else {
      // Async: schedule replication after lag
      const readyAt = currentTime + this.config.replicationLag;
      this.pendingWrites.push({
        key,
        value,
        committedAt: currentTime,
        readyAt,
      });
    }

    return {
      status: 'ok',
      writeTimestamp,
    };
  }

  /**
   * Read from a replica (or fallback to primary).
   * May return stale data if replication is still in progress.
   */
  read(key: string, currentTime: number): RequestResult {
    this.stats.reads++;

    if (this.availableConnections <= 0) {
      this.stats.rejections++;
      return {
        status: 'rejected_503',
        rejectedReason: 'connection_pool_exhausted',
      };
    }

    this.availableConnections--;
    this.stats.activeConnections = this.config.maxConnections - this.availableConnections;

    // Try to serve from a replica first (for load distribution)
    let result: { value: unknown; committedAt: number } | undefined;
    let usingPrimary = false;

    // Check replicas
    for (const replica of this.replicas) {
      const entry = replica.get(key);
      if (entry) {
        result = entry;
        break;
      }
    }

    // Fallback to primary if replica doesn't have it or is stale
    if (!result) {
      const primaryEntry = this.data.get(key);
      if (primaryEntry) {
        result = primaryEntry;
        usingPrimary = true;
      }
    }

    // Check if read is stale: in async mode, if the key was written but
    // replication hasn't completed yet, the read may be serving from an
    // incomplete or primary-only view.
    let isStale = false;
    if (this.config.replicationMode === 'async' && result) {
      const pendingWrite = this.pendingWrites.find(
        (pw) => pw.key === key
      );
      if (pendingWrite && currentTime < pendingWrite.readyAt) {
        isStale = true;
        this.stats.staleReads++;
      }
    }

    return {
      status: 'ok',
      data: result?.value,
      readTimestamp: currentTime + this.config.readLatency,
      ...(isStale ? { stale: true } : {}),
    };
  }

  /**
   * Process pending asynchronous replications at the given time.
   * Returns array of keys that were just replicated.
   */
  processReplications(currentTime: number): string[] {
    const replicated: string[] = [];
    const stillPending: typeof this.pendingWrites = [];

    for (const write of this.pendingWrites) {
      if (currentTime >= write.readyAt) {
        // Apply to all replicas
        for (const replica of this.replicas) {
          replica.set(write.key, {
            value: write.value,
            committedAt: write.committedAt,
          });
        }
        replicated.push(write.key);
      } else {
        stillPending.push(write);
      }
    }

    this.pendingWrites.length = 0;
    this.pendingWrites.push(...stillPending);
    return replicated;
  }

  /**
   * Release all in-flight connections (simulate request completion).
   */
  releaseConnections(count: number): void {
    this.availableConnections = Math.min(
      this.config.maxConnections,
      this.availableConnections + count
    );
    this.stats.activeConnections =
      this.config.maxConnections - this.availableConnections;
  }

  /**
   * Clear all data and reset state.
   */
  clear(): void {
    this.data.clear();
    for (const replica of this.replicas) {
      replica.clear();
    }
    this.pendingWrites.length = 0;
    this.availableConnections = this.config.maxConnections;
    this.stats = {
      reads: 0,
      writes: 0,
      staleReads: 0,
      rejections: 0,
      activeConnections: 0,
    };
  }

  /**
   * Reset stats without clearing data.
   */
  resetStats(): void {
    this.stats = {
      reads: 0,
      writes: 0,
      staleReads: 0,
      rejections: 0,
      activeConnections: this.getConnectionCount(),
    };
  }
}
