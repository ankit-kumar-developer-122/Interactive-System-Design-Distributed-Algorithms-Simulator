import type { Packet } from '../network/Packet.js';
import { Xorshift128Plus } from '../engine/Xorshift128Plus.js';

/** Available routing strategies */
export type RoutingStrategy = 'round-robin' | 'least-connections' | 'weighted';

/** Health status of a backend server */
export type ServerHealth = 'healthy' | 'degraded' | 'unhealthy';

/** Configuration for a single backend server */
export interface ServerNode {
  /** Unique server identifier */
  id: number;
  /** Weight for weighted routing (higher = more traffic) */
  weight: number;
  /** Current health status */
  healthStatus: ServerHealth;
  /** Number of active (in-flight) connections */
  connectionCount: number;
  /** Number of requests waiting in the queue */
  queueDepth: number;
}

/** Configuration for the LoadBalancer */
export interface LoadBalancerConfig {
  /** Routing strategy to use */
  strategy: RoutingStrategy;
  /** Interval in virtual time units between health checks */
  healthCheckInterval: number;
  /** Timeout after which an unresponsive server is marked unhealthy */
  healthCheckTimeout: number;
}

const DEFAULT_CONFIG: LoadBalancerConfig = {
  strategy: 'round-robin',
  healthCheckInterval: 100,
  healthCheckTimeout: 50,
};

/**
 * LoadBalancer distributes incoming requests across multiple backend servers
 * using configurable routing strategies with health-check failover.
 */
export class LoadBalancer {
  private readonly servers: Map<number, ServerNode> = new Map();
  private readonly config: LoadBalancerConfig;
  private rrIndex = 0;
  private lastHealthCheckTime = 0;
  private rng: Xorshift128Plus;

  constructor(config: Partial<LoadBalancerConfig> = {}, seed = 42) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = new Xorshift128Plus(seed);
  }

  /** Get the current configuration (immutable copy) */
  getConfig(): Readonly<LoadBalancerConfig> {
    return { ...this.config };
  }

  /** Add a server to the load balancer */
  addServer(id: number, weight = 1): void {
    this.servers.set(id, {
      id,
      weight,
      healthStatus: 'healthy',
      connectionCount: 0,
      queueDepth: 0,
    });
  }

  /** Remove a server from the load balancer */
  removeServer(id: number): void {
    this.servers.delete(id);
    // Adjust round-robin index if needed
    if (this.rrIndex >= this.servers.size) {
      this.rrIndex = 0;
    }
  }

  /** Get all servers (read-only) */
  getServers(): ReadonlyMap<number, ServerNode> {
    return new Map(this.servers);
  }

  /** Get a specific server's state */
  getServerState(id: number): ServerNode | undefined {
    const server = this.servers.get(id);
    return server ? { ...server } : undefined;
  }

  /**
   * Select the next server based on the configured routing strategy.
   * Returns undefined if no healthy servers are available.
   */
  selectServer(currentTime: number): number | undefined {
    const healthyServers = this.getHealthyServers();

    if (healthyServers.length === 0) {
      return undefined;
    }

    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(healthyServers);
      case 'least-connections':
        return this.selectLeastConnections(healthyServers);
      case 'weighted':
        return this.selectWeighted(healthyServers);
      default:
        return this.selectRoundRobin(healthyServers);
    }
  }

  /**
   * Record that a connection has started to the given server.
   */
  startConnection(serverId: number): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.connectionCount++;
    }
  }

  /**
   * Record that a connection has completed on the given server.
   */
  endConnection(serverId: number): void {
    const server = this.servers.get(serverId);
    if (server && server.connectionCount > 0) {
      server.connectionCount--;
    }
  }

  /**
   * Update queue depth for a server.
   */
  setQueueDepth(serverId: number, depth: number): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.queueDepth = depth;
    }
  }

  /**
   * Run health checks and update server statuses.
   * Should be called periodically based on healthCheckInterval.
   */
  runHealthChecks(currentTime: number): void {
    if (currentTime - this.lastHealthCheckTime < this.config.healthCheckInterval) {
      return;
    }

    this.lastHealthCheckTime = currentTime;

    for (const server of this.servers.values()) {
      // If server was recently unhealthy, give it a chance to recover
      if (server.healthStatus === 'unhealthy') {
        // Small chance of recovery during health check
        const shouldRecover = this.rng.next() < 0.3;
        if (shouldRecover) {
          server.healthStatus = 'healthy';
        }
      } else if (server.healthStatus === 'degraded') {
        // Degraded servers have a chance to become healthy
        const shouldRecover = this.rng.next() < 0.5;
        if (shouldRecover) {
          server.healthStatus = 'healthy';
        }
      }
    }
  }

  /**
   * Forcefully mark a server as unhealthy (simulates partition or crash).
   */
  markUnhealthy(serverId: number): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.healthStatus = 'unhealthy';
    }
  }

  /**
   * Mark a server as degraded (high latency, errors).
   */
  markDegraded(serverId: number): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.healthStatus = 'degraded';
    }
  }

  /**
   * Reset server statistics (connections, queue depth).
   */
  resetStats(): void {
    for (const server of this.servers.values()) {
      server.connectionCount = 0;
      server.queueDepth = 0;
    }
    this.rrIndex = 0;
  }

  /**
   * Update routing strategy dynamically.
   */
  setStrategy(strategy: RoutingStrategy): void {
    this.config.strategy = strategy;
    this.rrIndex = 0;
  }

  // ── Private selection algorithms ───────────────────────────────────

  private getHealthyServers(): ServerNode[] {
    return Array.from(this.servers.values())
      .filter(s => s.healthStatus !== 'unhealthy')
      .sort((a, b) => a.id - b.id); // deterministic ordering
  }

  private selectRoundRobin(servers: ServerNode[]): number {
    if (servers.length === 0) {
      return -1;
    }

    const n = servers.length;
    const idx = this.rrIndex % n;
    this.rrIndex = (idx + 1) % n;

    return servers[idx].id;
  }

  private selectLeastConnections(servers: ServerNode[]): number {
    let minConnections = Infinity;
    let selectedId = -1;

    for (const server of servers) {
      const load = server.connectionCount + server.queueDepth;
      if (load < minConnections) {
        minConnections = load;
        selectedId = server.id;
      } else if (load === minConnections && server.id < selectedId) {
        // Tie-break by lowest ID for determinism
        selectedId = server.id;
      }
    }

    return selectedId;
  }

  private selectWeighted(servers: ServerNode[]): number {
    const totalWeight = servers.reduce((sum, s) => sum + s.weight, 0);

    if (totalWeight === 0) {
      return servers[0]?.id ?? -1;
    }

    const threshold = Math.floor(this.rng.next() * totalWeight);
    let cumulative = 0;

    for (const server of servers) {
      cumulative += server.weight;
      if (threshold < cumulative) {
        return server.id;
      }
    }

    return servers[servers.length - 1].id;
  }
}
