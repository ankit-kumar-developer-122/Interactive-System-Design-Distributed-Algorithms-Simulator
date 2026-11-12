# Architecture — Interactive System Design & Distributed Algorithms Simulator

## 1. High-Level Data Flow

```
┌──────────────────┐      WebSocket/REST       ┌──────────────────┐
│   Web (React)    │ ──────────────────────►    │   API (FastAPI)  │
│  • Scenario list │                          │  • Auth/session  │
│  • Controls      │ ◄──────────────────────  │  • Validation    │
│  • Visualization │      JSON events         │  • Lifecycle mgmt│
└──────────────────┘                           └────────┬─────────┘
                                                        │
                                                  pybind11 /
                                                  subprocess /
                                                     │
                                         ┌──────────▼──────────┐
                                         │   Sim Engine (TS)    │
                                         │  • Event queue       │
                                         │  • State machines    │
                                         │  • Protocol models   │
                                         │  • Deterministic RNG │
                                         └─────────────────────┘
```

The simulator itself is platform-agnostic: a TypeScript discrete-event engine callable from Python via a compiled bundle or WASM export, and also callable directly by unit tests. The API wraps it so the web front-end stays decoupled from implementation details.

---

## 2. Discrete-Event Simulation Loop

### Core invariant
Time is **virtual**, not wall-clock. All nodes advance to the next scheduled event timestamp. This guarantees deterministic, reproducible runs regardless of host load.

### Algorithm (simplified pseudocode)

```ts
class DES {
  private clock = 0;
  private queue = new MinHeap<Event>();   // ordered by (time, tiebreak-seq)

  async run() {
    while (!this.queue.empty()) {
      const evt = this.queue.pop();               // O(log n)
      if (evt.time > this.clock) this.clock = evt.time;

      await this.dispatch(evt);                   // may spawn downstream events
      // NOTE: do NOT sleep, do NOT use real timers here
    }
    this.state = 'done';
  }

  schedule(event: Event, delta: number) {
    this.queue.push({ ...event, time: this.clock + delta, seq: ++seq });
  }
}
```

### Tie-breaking
When two events share the same virtual time, a secondary monotonic sequence number (`seq`) breaks ties deterministically. This ensures identical results across platforms and thread counts.

### Why not real-time `setTimeout` loops?
See ADR-001. Short version: the Min-Heap gives exact virtual time advancement; `setTimeout` accumulates drift, introduces OS jitter, and can't reproduce runs bit-for-bit.

---

## 3. Web Worker Snapshot Protocol

State snapshots let the UI pause, rewind, and jump to any moment without restarting the entire run. The protocol lives between the **API** and the **Sim Engine**.

### Lifecycle

```
Web  ──snapshot(tick)────────► API  ──serialize(engine)──► binary/packed JSON
Web  ──restore(snapshot)────► API  ──deserialize(bytes)──► Engine state restored
```

### Serialization contract

| Field | Type | Notes |
|-------|------|-------|
| `clock` | `u64` | Virtual time at serialization point |
| `queue` | `Event[]` | Filled heap sorted ascending; size ≤ 10 000 normally |
| `nodes` | `NodeState[]` | Per-process state (variables, log, queues) |
| `rngState` | `Uint8Array[256]` | Full PRNG state (Xorshift128+) so continuation is deterministic |
| `meta.tick` | `u64` | Host-side step counter for human display |

### Packing format
Messages are packed with [MessagePack](https://msgpack.org/) into a single contiguous buffer. This keeps WebSocket frames bounded (< 4 MB typical), avoids repeated GC pressure from large JS objects, and allows the engine to store snapshots on disk when requested.

### Concurrency model
Snapshots are taken **at logical checkpoints** (after a batch of events completes within the same tick window), never mid-dispatch. This avoids partial-state corruption and means the heap is in a stable, fully-ordered state when captured.

---

## 4. Package Responsibilities

### `packages/sim-engine`
- Pure simulation primitives: `MinHeap`, `Event`, `Protocol`, `NodeState`
- Deterministic pseudo-random number generator (xorshift128+) seeded by scenario hash
- Scenario definitions: Raft, Paxos, CRDTs, Gossip, leader election
- Exported API: `runScenario(scenario, params)` → async generator yielding `TickEvent`s
- Unit-tested with fixed seeds; integration-tested against golden outputs

### `packages/api`
- FastAPI layer exposing WebSocket stream and REST endpoints
- Validates scenarios, enforces resource limits (max ticks, memory cap)
- Manages per-session engine instances
- Handles persistence of snapshots to disk under `/data/snapshots/<id>.msgpack`
- Zero simulation knowledge beyond deserializing `Snapshot` and passing it back in

### `packages/web`
- React 18 + Vite SPA; TypeScript strict mode
- Visualizes active processes, message queues, state transitions (SVG/D3)
- Timeline scrubber backed by snapshot restoration
- Sends control commands to `/ws/sim` and receives `TickEvent` deltas

---

## 5. Determinism Guarantees

For a given scenario with a fixed seed:
1. Every event in the queue has an exact `(time, seq)` pair.
2. Events are processed in strict order.
3. Any randomness comes exclusively from the seeded PRNG, whose state is part of the snapshot.
4. Floating-point operations are avoided; integer-only arithmetic where possible.

Reproducing a past run is therefore a matter of loading the final snapshot and re-running forward — identical output guaranteed.
