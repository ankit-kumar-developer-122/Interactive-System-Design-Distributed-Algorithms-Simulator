import type { Packet } from '../network/Packet.js';

/** Status codes for request handling */
export enum RequestStatus {
  ACCEPTED = 'accepted',
  REJECTED_503 = 'rejected_503',
  DROPPED = 'dropped',
}

/** Configuration for an application server */
export interface AppServerConfig {
  /** Maximum number of worker threads */
  maxWorkers: number;
  /** Maximum size of the request queue */
  maxQueueSize: number;
  /** Base latency for processing a request (time units) */
  baseLatency: number;
  /** Latency degradation factor (how much latency increases under load) */
  saturationFactor: number;
}

const DEFAULT_CONFIG: AppServerConfig = {
  maxWorkers: 4,
  maxQueueSize: 10,
  baseLatency: 10,
  saturationFactor: 2,
};

/** Result of submitting a request to the server */
export interface SubmissionResult {
  status: RequestStatus;
  /** The packet that was processed, or undefined if rejected/dropped */
  packet?: Packet;
  /** Estimated completion time (only for accepted requests) */
  estimatedCompletionTime?: number;
  /** Current queue depth at time of submission */
  queueDepthAtSubmission: number;
  /** Number of active workers at time of submission */
  workerCountAtSubmission: number;
}

/**
 * AppServer simulates a backend server with concurrent workers,
 * bounded request queue, and non-linear latency degradation.
 */
export class AppServer {
  private readonly config: AppServerConfig;
  /** Currently busy workers (processing requests) */
  private busyWorkers = 0;
  /** Queue of pending requests */
  private requestQueue: Packet[] = [];
  /** Track when each worker will finish */
  private workerFinishTimes: Array<{ time: number; packet: Packet }> = [];

  constructor(config: Partial<AppServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get current configuration (immutable copy) */
  getConfig(): Readonly<AppServerConfig> {
    return { ...this.config };
  }

  /** Get current number of busy workers */
  getBusyWorkerCount(): number {
    return this.busyWorkers;
  }

  /** Get total available workers (busy + idle) */
  getTotalWorkerCount(): number {
    return this.config.maxWorkers;
  }

  /** Get current queue depth */
  getQueueDepth(): number {
    return this.requestQueue.length;
  }

  /** Get the maximum queue size */
  getMaxQueueSize(): number {
    return this.config.maxQueueSize;
  }

  /** Get current utilization ratio (busy / total workers) */
  getUtilization(): number {
    return this.busyWorkers / this.config.maxWorkers;
  }

  /**
   * Submit a request to the server.
   * Returns a result indicating whether the request was accepted or rejected.
   */
  submitRequest(packet: Packet, currentTime: number): SubmissionResult {
    // Complete any workers that have finished by now
    this.processCompletedWorkers(currentTime);

    const queueDepthBefore = this.requestQueue.length;
    const workerCountBefore = this.busyWorkers;

    // Check if we can accept the request
    if (this.isFull()) {
      // Queue is full - reject with 503
      return {
        status: RequestStatus.REJECTED_503,
        queueDepthAtSubmission: queueDepthBefore,
        workerCountAtSubmission: workerCountBefore,
      };
    }

    // Calculate latency with saturation-dependent degradation
    const estimatedCompletionTime = this.calculateLatency(currentTime);

    // Add to queue or assign to worker
    const idleWorkers = this.idleWorkers();
    if (idleWorkers > 0) {
      // Assign directly to an idle worker
      this.assignToWorker(packet, estimatedCompletionTime);
    } else {
      // Add to queue
      this.requestQueue.push(packet);
    }

    return {
      status: RequestStatus.ACCEPTED,
      packet: { ...packet },
      estimatedCompletionTime,
      queueDepthAtSubmission: queueDepthBefore,
      workerCountAtSubmission: workerCountBefore,
    };
  }

  /**
   * Complete all requests that are due by the given time.
   * Returns array of completed packets.
   */
  processRequests(currentTime: number): Packet[] {
    const completed: Packet[] = [];
    this.processCompletedWorkers(currentTime);

    // Also try to start processing queued requests
    this.drainQueue(currentTime);

    return completed;
  }

  /**
   * Get the next packet to be completed and its completion time.
   * Used for deterministic testing.
   */
  getNextCompletionEvent(currentTime: number): { packet: Packet; time: number } | undefined {
    if (this.workerFinishTimes.length === 0) {
      return undefined;
    }

    const nextFinish = this.workerFinishTimes[0];
    if (nextFinish.time <= currentTime) {
      return nextFinish;
    }

    return undefined;
  }

  /**
   * Reset the server state (for replay/testing).
   */
  reset(): void {
    this.busyWorkers = 0;
    this.requestQueue = [];
    this.workerFinishTimes = [];
  }

  // ── Private methods ────────────────────────────────────────────────

  private isFull(): boolean {
    return this.busyWorkers >= this.config.maxWorkers &&
           this.requestQueue.length >= this.config.maxQueueSize;
  }

  private idleWorkers(): number {
    return this.config.maxWorkers - this.busyWorkers;
  }

  /**
   * Process requests that have finished by the given time.
   */
  private processCompletedWorkers(currentTime: number): void {
    // Remove finished workers and free up capacity
    this.workerFinishTimes = this.workerFinishTimes.filter(w => w.time > currentTime);
    this.busyWorkers = this.workerFinishTimes.length;
  }

  /**
   * Try to move queued requests to idle workers.
   */
  private drainQueue(currentTime: number): void {
    while (this.requestQueue.length > 0 && this.idleWorkers() > 0) {
      const packet = this.requestQueue.shift()!;
      const completionTime = currentTime + this.config.baseLatency;
      this.workerFinishTimes.push({ time: completionTime, packet });
      this.busyWorkers++;
    }
  }

  /**
   * Assign a packet to a worker with calculated completion time.
   */
  private assignToWorker(packet: Packet, completionTime: number): void {
    this.workerFinishTimes.push({ time: completionTime, packet });
    this.busyWorkers++;
  }

  /**
   * Calculate latency with non-linear degradation based on utilization.
   * Uses an exponential backoff model: latency *= (1 + utilization * saturationFactor)
   */
  private calculateLatency(currentTime: number): number {
    const utilization = this.getUtilization();

    // Non-linear latency degradation: as utilization approaches 1,
    // latency increases exponentially
    const degradationFactor = 1 + (utilization * this.config.saturationFactor);

    return currentTime + this.config.baseLatency * degradationFactor;
  }
}
