import type { Event, NodeState, Snapshot, PacingMode } from '../types/index.js';
import { VirtualClock } from './VirtualClock.js';
import { MinHeap } from './MinHeap.js';
import { Xorshift128Plus } from './Xorshift128Plus.js';

export interface StepCallback {
  (event: Event, clock: number): void;
}

export interface EngineOptions {
  initialNodes?: Map<number, NodeState>;
  onEvent?: StepCallback;
  tickMs?: number;
}

/**
 * A discrete-event simulation engine with support for multiple pacing modes.
 *
 * Pacing modes:
 * - 'step': manual control via step() — processes exactly one event per call
 * - 'fast': run to completion as quickly as possible
 * - 'realtime': pace events by the configured tickMs interval
 */
export class SimulationEngine {
  private clock = new VirtualClock();
  private queue = new MinHeap<Event>();
  private rng = new Xorshift128Plus(0);
  private nextSeq = 0;
  private nodes = new Map<number, NodeState>();
  private state: 'idle' | 'running' | 'paused' | 'done' = 'idle';
  private tickCount = 0;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastStepCallback: StepCallback | null = null;
  private readonly tickMs: number;

  constructor(options: EngineOptions = {}) {
    const { initialNodes, onEvent, tickMs = 16 } = options;
    if (initialNodes) {
      this.nodes = new Map(initialNodes);
    }
    this.lastStepCallback = onEvent ?? null;
    this.tickMs = tickMs;
  }

  /** Returns the current virtual clock time. */
  get currentTime(): number {
    return this.clock.time;
  }

  /** Returns the current pacing mode. */
  get pacingMode(): PacingMode {
    // We infer from internal behavior; default to 'fast' when not set
    return this.paceStrategy;
  }
  private paceStrategy: PacingMode = 'fast';

  /** Returns true if there are pending events in the queue. */
  hasPendingEvents(): boolean {
    return !this.queue.empty;
  }

  /** Returns the number of pending events. */
  pendingEventCount(): number {
    return this.queue.size;
  }

  /** Returns the number of steps taken so far. */
  getTickCount(): number {
    return this.tickCount;
  }

  /** Returns a copy of the node states. */
  getNodeStates(): ReadonlyMap<number, NodeState> {
    return new Map(this.nodes);
  }

  /**
   * Start running the engine in the given pacing mode.
   * @param mode - 'step', 'fast', or 'realtime'
   */
  start(mode: PacingMode = 'fast'): void {
    if (this.state === 'done') {
      throw new Error('Engine cannot be restarted after completion. Create a new instance.');
    }
    if (this.state === 'running') {
      return; // already running
    }
    this.paceStrategy = mode;
    this.state = 'running';

    if (mode === 'step') {
      // In step mode, we don't auto-run; caller must call step()
      // But start() prepares the engine, so we just set the mode
      return;
    }

    if (mode === 'fast') {
      this.runFastLoop();
    } else if (mode === 'realtime') {
      this.runRealtimeLoop();
    }
  }

  /**
   * Step forward by exactly one event.
   * Returns the event that was processed, or undefined if no events remain.
   */
  step(): Event | undefined {
    if (this.state !== 'running') {
      throw new Error(`Cannot step: engine is ${this.state}`);
    }

    const event = this.queue.pop();
    if (!event) {
      this.state = 'done';
      return undefined;
    }

    if (event.time > this.clock.time) {
      this.clock.advance(event.time);
    }

    this.tickCount++;
    this.dispatch(event);
    return event;
  }

  /** Pause the engine. Can be resumed with resume(). */
  pause(): void {
    if (this.state === 'running') {
      this.state = 'paused';
      if (this.timeoutId !== null) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    }
  }

  /** Resume a paused engine. */
  resume(): void {
    if (this.state !== 'paused') {
      return;
    }
    this.state = 'running';
    if (this.paceStrategy === 'fast') {
      this.runFastLoop();
    } else if (this.paceStrategy === 'realtime') {
      this.runRealtimeLoop();
    }
  }

  /** Stop the engine immediately. */
  stop(): void {
    this.state = 'idle';
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Schedule an event into the engine.
   * The event's time is computed relative to the current virtual clock + delta.
   */
  schedule(eventType: string, nodeId: number, delta: number, data?: Record<string, unknown>): void {
    const seq = ++this.nextSeq;
    const event: Event = {
      type: eventType,
      nodeId,
      time: this.clock.time + delta,
      seq,
      data,
    };
    this.queue.push(event);
  }

  /**
   * Set the state of a simulated node.
   */
  setNodeState(nodeId: number, state: NodeState): void {
    this.nodes.set(nodeId, { ...state });
  }

  /**
   * Take a snapshot of the current engine state.
   */
  takeSnapshot(): Snapshot {
    return {
      clock: this.clock.time,
      events: this.queue.toArray(),
      nodes: new Map(this.nodes),
      rngState: this.rng.getState(),
      seq: this.nextSeq,
      tickCount: this.tickCount,
    };
  }

  /**
   * Restore the engine from a snapshot.
   * This replaces all internal state with the snapshot's contents.
   */
  restoreFromSnapshot(snapshot: Snapshot): void {
    this.clock.reset();
    this.clock.time = snapshot.clock;
    this.queue.clear();
    for (const evt of snapshot.events) {
      this.queue.push(evt);
    }
    this.nodes = new Map(snapshot.nodes);
    this.rng.setState(snapshot.rngState);
    this.nextSeq = snapshot.seq;
    this.tickCount = snapshot.tickCount;
    this.state = 'idle';
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Get a deterministic random float in [0, 1).
   */
  random(): number {
    return this.rng.next();
  }

  /**
   * Get a deterministic random integer in [0, max).
   */
  randomInt(max: number): number {
    return this.rng.nextInt(max);
  }

  // ── Internal dispatch ──────────────────────────────────────────────

  private dispatch(event: Event): void {
    // Notify callback
    if (this.lastStepCallback) {
      this.lastStepCallback(event, this.clock.time);
    }
    // Default dispatch does nothing more; subclasses can override
  }

  // ── Fast-mode loop ─────────────────────────────────────────────────

  private async runFastLoop(): Promise<void> {
    while (this.state === 'running' && !this.queue.empty) {
      const event = this.step();
      if (!event) {
        break;
      }
    }
    if (this.state === 'running') {
      this.state = 'done';
    }
  }

  // ── Realtime-mode loop ─────────────────────────────────────────────

  private runRealtimeLoop(): void {
    if (this.state !== 'running') {
      return;
    }

    const processNext = () => {
      if (this.state !== 'running') return;

      const event = this.step();
      if (!event) {
        this.state = 'done';
        return;
      }

      // Schedule next tick based on time until the next event
      const delay = Math.max(0, this.tickMs - 1);
      this.timeoutId = setTimeout(processNext, delay);
    };

    processNext();
  }
}
