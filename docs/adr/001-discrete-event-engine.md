# ADR-001: Discrete-Event Engine — Virtual-Clock Min-Heap Event Queue

| Field        | Value                                              |
|-------------|-----------------------------------------------------|
| Status       | Accepted                                            |
| Date         | 2025-11-12                                          |
| Decision-makers | Core architecture team (sim-engine owners)      |
| Consequences | All simulation code in `packages/sim-engine`       |

## Context

We are building an interactive simulator for distributed algorithms (Raft, Paxos, gossip protocols, CRDT convergence, etc.). The simulator must:

1. **Be deterministic**: Given the same scenario and seed, every run produces identical event traces, regardless of host OS, CPU speed, or load.
2. **Support interactive control**: Pause, step-forward, jump to arbitrary ticks, and restore from saved snapshots.
3. **Model inter-process latency accurately**: Message delays, timeouts, and elections must respect an abstract notion of time independent of wall-clock reality.
4. **Be fast enough for realistic scenarios**: Hundreds of simulated nodes exchanging thousands of messages over tens of thousands of virtual ticks.

A naive approach would drive the simulation with real-world timers (`setTimeout` / `setInterval` in JS, `threading.Timer` in Python). This document explains why a **virtual-clock min-heap event queue** is the right choice instead.

## Decision

Use a **deterministic discrete-event simulation (DES) engine** built around a **min-heap priority queue keyed on virtual time** (with a monotonic tie-breaker sequence number). The engine advances by repeatedly extracting the earliest pending event, processing it (which may enqueue further events), and advancing its internal clock to that event's timestamp. Wall-clock time plays no role in event ordering.

Pseudocode:

```ts
class DES {
  private clock = 0;
  private queue = new MinHeap<Event>(); // ordered by (time, tiebreak-seq)

  async run() {
    while (!this.queue.empty()) {
      const evt = this.queue.pop();            // O(log n)
      if (evt.time > this.clock) this.clock = evt.time;

      await this.dispatch(evt);                // may schedule future events
      // NOTE: do NOT sleep, do NOT use real timers here
    }
    this.state = 'done';
  }

  schedule(event: Event, delta: number) {
    this.queue.push({ ...event, time: this.clock + delta, seq: ++seq });
  }
}
```

Key properties enforced at the type level:
- `Event.time: number` — non-negative virtual timestamp.
- `Event.seq: number` — globally monotonic tie-breaker ensuring total order.
- Heap ordering is lexicographic `(time, seq)`.

## Alternatives Considered

### A. Real-time `setTimeout` loop (wall-clock driven)
Schedule each event with `setTimeout(fn, delay)`. Process callbacks as they fire.

**Rejected because:**
- **Non-deterministic under load.** OS scheduler variance makes callback firing times vary. Two runs of the same scenario will diverge.
- **No meaningful pause/rewind.** You cannot "freeze" a `setTimeout` loop and resume from an arbitrary point without reimplementing the entire scheduling layer.
- **Clock drift.** Over long simulations (millions of ticks), accumulated jitter becomes significant.
- **Hard to inspect mid-run.** No clean snapshot mechanism — you'd need to capture pending timers individually and serialize their remaining delays.

### B. Fixed-tick push-based simulation (discrete time steps)
Advance by a fixed `Δt` each frame; process all events scheduled for the current bin.

**Rejected because:**
- **Wasteful for sparse systems.** Many distributed protocols have long idle periods between messages. Pushing empty ticks burns CPU.
- **Accuracy ceiling.** Timing resolution is limited to `Δt`; events closer than `Δt` become indistinguishable, which matters for timeout-sensitive protocols like Raft.
- **Still needs a queue.** Even with fixed ticks you effectively rebuild a heap — just coarser and less flexible.

### C. Actor-model / message-passing runtime (e.g., Erlang/Elixir-style)
Each process runs in its own lightweight thread; sends are asynchronous mailbox deliveries.

**Rejected because:**
- **Overkill for a simulation tool.** We want to *observe* and *replay* execution, not abstract it behind asynchronous message boundaries.
- **Concurrency introduces non-determinism** unless heavily constrained, which defeats the primary goal.
- **Steeper learning curve** for contributors who mainly care about protocol semantics, not runtime mechanics.

### D. Synchronous linear scan (no heap)
Store all events in an unsorted array; find minimum on each iteration.

**Rejected because:**
- `O(n²)` growth. For a few hundred events this is fine, but production scenarios hit millions.
- The heap's `O(log n)` amortized cost scales gracefully.

## Consequences

### Positive
- **Bit-for-bit reproducibility.** Identical inputs yield identical outputs — critical for teaching and debugging.
- **Efficient sparse simulation.** Only processes events that actually occur; no wasted cycles on empty time bins.
- **Clean snapshot protocol.** At any checkpoint the heap is in a known, ordered state; serializing `(events, rng_state, node_states)` captures everything needed to resume.
- **Expressive time model.** Any delay distribution (fixed, uniform, exponential via PRNG) maps naturally onto event timestamps.
- **Platform agnostic.** Same algorithm runs in Node, Deno, Bun, or compiled to WASM — no dependency on host timer precision.

### Negative / Mitigations
- **Implementation complexity.** The heap and event types require careful design. *Mitigation*: well-tested core module; public API stays simple (`runScenario(...)`).
- **Memory grows with event volume.** Long runs accumulate large heaps. *Mitigation*: periodic compaction / pruning of old fired events; max-heap-size guardrails in the API.
- **No natural notion of "real-time play".** If users want the simulation to run at near-wall-clock pace, we add a thin pacing wrapper, not change the engine. *Mitigation*: optional `pacingMode: 'step' | 'fast' | 'realtime'`.

## Reference

- Banks, Carson, Nelson, Nicol. *Discrete-Event System Simulation*, 5th ed.
- POSIX.1-2017 on timer resolution variability.
- Internal design notes from the `sim-engine` lead (2025-10).
