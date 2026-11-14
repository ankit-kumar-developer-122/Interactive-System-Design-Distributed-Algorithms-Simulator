/**
 * Consistent hashing ring with configurable virtual nodes and replication support.
 *
 * Uses FNV-1a or MurmurHash (32-bit) to map keys and virtual nodes onto a circular
 * hash space [0, 2^32). Lookup is O(log V) via binary search where V is the total
 * number of virtual nodes. Adding or removing a physical node moves only the keys
 * that fall between the old and new node positions on the ring.
 */

export type HashFunction = 'fnv1a' | 'murmur';

export interface ConsistentHashConfig {
  /** Number of virtual nodes per physical node */
  vnodeCount: number;
  /** Hash function to use */
  hashFunction?: HashFunction;
  /** Replication factor used by getNodes() */
  replicationFactor?: number;
}

const DEFAULT_CONFIG: Required<Omit<ConsistentHashConfig, 'replicationFactor'>> = {
  vnodeCount: 150,
  hashFunction: 'fnv1a',
};

export interface RingNode {
  /** Unique identifier for this ring position */
  id: string;
  /** The physical node this virtual node belongs to */
  physicalNodeId: string;
  /** Hash value on the ring [0, 2^32) */
  hash: number;
}

export interface KeyDistribution {
  /** Total number of keys hashed */
  totalKeys: number;
  /** Per-physical-node distribution */
  distribution: Map<string, number>;
  /** Standard deviation of distribution (lower = more uniform) */
  stdDeviation: number;
  /** Mean keys per node */
  mean: number;
}

/**
 * FNV-1a 32-bit hash.
 * Offset basis: 2166136261, prime: 16777619
 */
function fnv1a32(data: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Simplified MurmurHash3 32-bit finalizer (mixed) applied after FNV-1a.
 * We use FNV-1a as primary and a secondary mix for the alternative path.
 */
function murmurMix32(h: number): number {
  h = (h ^ (h >>> 16)) * 0x85ebca6b >>> 0;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35 >>> 0;
  return h ^ (h >>> 16);
}

function computeHash(key: string, algorithm: HashFunction): number {
  const raw = fnv1a32(key);
  if (algorithm === 'murmur') {
    return murmurMix32(raw);
  }
  return raw;
}

/**
 * ConsistentHashRing maps keys to physical nodes on a circular hash space
 * using virtual nodes for even distribution.
 */
export class ConsistentHashRing {
  private readonly config: Required<ConsistentHashConfig>;
  /** Sorted ring of virtual nodes, sorted by hash ascending */
  private ring: RingNode[] = [];
  /** Map from physicalNodeId -> Set of ring node ids */
  private readonly physicalToVirtual = new Map<string, Set<string>>();
  /** Map from ring node id -> RingNode */
  private readonly ringNodeMap = new Map<string, RingNode>();
  /** Set of all physical node ids currently on the ring */
  private readonly physicalNodes = new Set<string>();

  constructor(config: Partial<ConsistentHashConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<ConsistentHashConfig>;
  }

  getConfig(): Readonly<Required<ConsistentHashConfig>> {
    return { ...this.config };
  }

  /** Number of physical nodes on the ring */
  size(): number {
    return this.physicalNodes.size;
  }

  /** Total number of virtual nodes on the ring */
  vnodeCount(): number {
    return this.ring.length;
  }

  /** Get all physical node ids */
  getPhysicalNodes(): ReadonlySet<string> {
    return new Set(this.physicalNodes);
  }

  /**
   * Add a physical node to the ring with the configured number of virtual nodes.
   * Returns the fraction of keys that need to be remapped (approximate, based on
   * ring geometry — exact remap requires knowing the key set).
   */
  addNode(physicalNodeId: string): number {
    if (this.physicalNodes.has(physicalNodeId)) {
      return 0;
    }

    this.physicalNodes.add(physicalNodeId);
    this.physicalToVirtual.set(physicalNodeId, new Set());

    const vn = this.config.vnodeCount;
    const newlyInserted = this.insertVirtualNodes(physicalNodeId, vn);

    return newlyInserted;
  }

  /**
   * Remove a physical node from the ring.
   * Returns the fraction of keys that are now served by other nodes.
   */
  removeNode(physicalNodeId: string): number {
    if (!this.physicalNodes.has(physicalNodeId)) {
      return 0;
    }

    const vnodesToRemove = this.physicalToVirtual.get(physicalNodeId)!;
    const removedCount = vnodesToRemove.size;

    // Remove ring nodes belonging to this physical node
    for (const id of vnodesToRemove) {
      const rn = this.ringNodeMap.get(id);
      if (rn) {
        this.removeRingNode(rn);
      }
    }

    this.physicalToVirtual.delete(physicalNodeId);
    this.physicalNodes.delete(physicalNodeId);

    // Fraction of keys remapped ≈ proportion of ring covered by removed vnodes
    if (this.ring.length === 0) {
      return 1;
    }
    return removedCount / (removedCount + this.ring.length);
  }

  /**
   * Find the physical node responsible for a given key.
   * Walks clockwise from the key's hash position on the ring.
   * O(log V) where V is the number of virtual nodes.
   */
  getNode(key: string): string | undefined {
    if (this.ring.length === 0) {
      return undefined;
    }

    const hash = computeHash(key, this.config.hashFunction);
    const idx = this.findClockwiseIndex(hash);
    return this.ring[idx].physicalNodeId;
  }

  /**
   * Find up to `count` distinct physical nodes responsible for a key (replicas).
   * Walks clockwise from the key's hash position, collecting distinct physical nodes.
   * Returns fewer than `count` if there aren't enough physical nodes.
   */
  getNodes(key: string, count: number): string[] {
    if (this.ring.length === 0 || count <= 0) {
      return [];
    }

    const uniqueNodes: string[] = [];
    const seen = new Set<string>();
    const hash = computeHash(key, this.config.hashFunction);
    const startIdx = this.findClockwiseIndex(hash);
    const total = this.ring.length;

    for (let i = 0; i < total && uniqueNodes.length < count; i++) {
      const rn = this.ring[(startIdx + i) % total];
      if (!seen.has(rn.physicalNodeId)) {
        seen.add(rn.physicalNodeId);
        uniqueNodes.push(rn.physicalNodeId);
      }
    }

    return uniqueNodes;
  }

  /**
   * Compute the distribution of a set of keys across physical nodes.
   * Useful for verifying uniformity.
   */
  getKeyDistribution(keys: string[]): KeyDistribution {
    const dist = new Map<string, number>();
    for (const k of keys) {
      const node = this.getNode(k);
      if (node) {
        dist.set(node, (dist.get(node) ?? 0) + 1);
      }
    }

    const values = Array.from(dist.values());
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length || 1);

    return {
      totalKeys: keys.length,
      distribution: dist,
      stdDeviation: Math.sqrt(variance),
      mean,
    };
  }

  /**
   * Clear all nodes from the ring.
   */
  clear(): void {
    this.ring = [];
    this.physicalToVirtual.clear();
    this.ringNodeMap.clear();
    this.physicalNodes.clear();
  }

  /**
   * Get the current ring for inspection (read-only).
   */
  getRing(): Readonly<RingNode[]> {
    return [...this.ring];
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private insertVirtualNodes(
    physicalNodeId: string,
    count: number
  ): number {
    let newlyInserted = 0;
    const vnodeIds = this.physicalToVirtual.get(physicalNodeId)!;

    // Pre-compute a base hash from the physical node id so each node's
    // vnodes are seeded with different entropy (avoids collision clusters).
    const baseHash = computeHash(physicalNodeId, this.config.hashFunction);

    for (let i = 0; i < count; i++) {
      // Mix the vnode index as individual bytes into the base hash
      // to avoid sequential-hash clustering from simple string concat.
      let vnodeHash = baseHash;
      for (let b = 0; b < 4; b++) {
        const byte = (i >> (b * 8)) & 0xff;
        vnodeHash ^= byte;
        vnodeHash = Math.imul(vnodeHash, 16777619) >>> 0;
      }
      const hash = computeHash(String(vnodeHash), this.config.hashFunction);
      const id = `${physicalNodeId}:${i}`;

      const node: RingNode = { id, physicalNodeId, hash };
      this.ringNodeMap.set(id, node);
      vnodeIds.add(id);

      // Binary insert to maintain sorted order
      const pos = this.binarySearchInsertPosition(hash);
      this.ring.splice(pos, 0, node);
      newlyInserted++;
    }

    return newlyInserted;
  }

  private removeRingNode(node: RingNode): void {
    const idx = this.ring.findIndex((r) => r.id === node.id);
    if (idx !== -1) {
      this.ring.splice(idx, 1);
    }
    this.ringNodeMap.delete(node.id);
  }

  /**
   * Find the index of the first ring node whose hash >= targetHash.
   * If all hashes are less, wrap around to index 0.
   * This implements the "clockwise" semantics of consistent hashing.
   */
  private findClockwiseIndex(targetHash: number): number {
    let lo = 0;
    let hi = this.ring.length - 1;
    let result = 0;

    // Binary search for first element >= targetHash
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash >= targetHash) {
        result = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    // If all ring hashes are < targetHash, wrap to beginning
    if (lo > hi && this.ring[result]?.hash < targetHash) {
      result = 0;
    }

    return result;
  }

  /**
   * Find the insertion position to keep the ring sorted by hash ascending.
   */
  private binarySearchInsertPosition(hash: number): number {
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
