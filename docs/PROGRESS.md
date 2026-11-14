# Progress Tracker

This file records weekly milestones, daily tasks, and open questions. Update it as work progresses.

---

## Week 1 — Foundations (2025-11-10 → 2025-11-16)

**Goal:** Monorepo scaffold running, first minimal simulation loop functional, documentation baseline laid down.

---

### Day 1 — Monday 2025-11-10 · Repo scaffolding
- [x] Initialize pnpm workspaces for `packages/sim-engine` (api/web stubs created)
- [x] Create `CLAUDE.md` describing structure, tech stack, commands
- [x] Add root `package.json` with monorepo scripts (`build`, `test`, `lint`, `typecheck`)
- [x] Configure pnpm workspace (`pnpm-workspace.yaml`, lockfile)
- [x] ~~Run `npm install && npm run build` end-to-end~~ — verified via `pnpm run build` + `pnpm exec vitest run`
- **Blockers:** None

---

### Day 2 — Tuesday 2025-11-11 · Simulator core skeleton
- [x] Define TypeScript types: `Event`, `NodeState`, `Snapshot`, `PacingMode`, `SimulationParams`
- [x] Implement `MinHeap<Event>` with `(time, seq)` lexicographic ordering
- [x] Write unit tests for heap invariants (push/pop/peek, 100-event ordering, clear, toArray)
- [x] Implement `VirtualClock` with forward-only invariant
- [x] Implement seedable `Xorshift128Plus` PRNG with state serialization round-trip
- [x] Implement `SimulationEngine` with `schedule()`, `step()`, pause/resume/stop
- [x] Pacing modes: `'step'` (manual), `'fast'` (run to completion), `'realtime'` (timed delays)
- [x] Snapshot / restore: full state serialization including clock, queue, nodes, RNG state, tick count
- [x] All tests pass: 50 Vitest tests, `tsc --noEmit` clean, `tsc` build succeeds
- **Blockers:** None

---

### Day 3 — Wednesday 2025-11-12 · Documentation baseline
- [x] Write `docs/ARCHITECTURE.md` (DES loop + snapshot protocol overview)
- [x] Write `docs/PROGRESS.md` (this file — initial skeleton)
- [x] Write `docs/adr/001-discrete-event-engine.md` explaining heap vs setTimeout rationale
- [ ] Review ADR for accuracy against agreed design decisions
- **Blockers:** None

---

### Day 4 — Thursday 2025-11-13 · First scenario model
- [x] Define `SimpleLeaderElection` scenario shape (3 processes, timer-driven)
- [x] Register it in `sim-engine/src/scenarios/index.ts`
- [x] Run golden-path test: verify first three ticks produce expected event log
- [x] Export scenario definitions via a stable JSON schema for future validation
- **Blockers:** None

---

### Day 3–4 (continued) — Network & Traffic Layer
- [x] Implement `Packet` interface with `id`, `from`, `to`, `data`, `createdAt`, `estimatedArrival`, `delivered`, `dropped`
- [x] Implement `NetworkLink` class supporting:
  - Configurable `baseLatency`, `jitterRange`, `jitterType` ('uniform' | 'gaussian')
  - Seeded uniform jitter in [-range, +range]
  - Seeded Gaussian approximation via CLT (sum of 12 uniforms − 6) scaled by `jitterRange`
  - Configurable `packetLossPercentage` (0–100) applied per-send
  - Bandwidth-limited serialization delay (`1/bandwidth`)
  - `isPartitioned()` / `setPartitioned(bool)` toggles that drop all in-flight packets
  - `send(packet, currentTime)` → returns packet with `estimatedArrival` or `null` on drop/partition
  - `processPackets(currentTime, maxProcessingRate?)` → FIFO delivery with bandwidth throttling
  - `clearPending()`, `pendingCount()`, `updateConfig(updates)`, `getConfig()`
- [x] Implement `ClientGenerator` class supporting:
  - `'constant'` pattern: deterministic regular intervals
  - `'burst'` pattern: burstSize packets followed by cooldown of `interval * burstMultiplier`
  - `'poisson'` pattern: exponential inter-arrival times via inverse CDF (`-mean * ln(U)`)
  - Deterministic RNG (seeded Xorshift128+) for reproducible traffic
  - Multi-target cycling via modulo on monotonic counter
  - `reset()` to restore initial state for replay
- [x] Write 47 deterministic Vitest unit tests (23 NetworkLink + 24 ClientGenerator):
  - Packet drops at various loss percentages
  - Partition injection/healing round-trips
  - Jitter bounds (zero jitter exactness, uniform range, Gaussian distribution stats)
  - Poisson mean convergence over large samples
  - Burst cluster detection and cooldown gaps
  - Bandwidth-limited serialization delay ordering
  - Determinism across seeds and resets
- [x] Update `src/index.ts` to export network and generator modules
- [x] `tsc --noEmit` clean, `npm run build` succeeds, all 103 tests pass
- **Blockers:** None

---

### Day 5 — Friday 2025-11-14 · Compute & Routing Nodes
- [x] Implement `LoadBalancer` class supporting:
  - Round-Robin routing with automatic skip of unhealthy servers
  - Least-Connections routing (considers both active connections and queue depth)
  - Weighted routing using seeded PRNG for deterministic distribution
  - Health-check failover with configurable interval and timeout
  - Dynamic server add/remove, health status updates (healthy/degraded/unhealthy)
  - Connection tracking and statistics reset
- [x] Implement `AppServer` class modeling:
  - Concurrent worker threads with configurable `maxWorkers`
  - Bounded request queue with configurable `maxQueueSize`
  - Returns `RequestStatus.REJECTED_503` when both workers and queue are full
  - Non-linear latency degradation: `latency = baseLatency * (1 + utilization * saturationFactor)`
  - Utilization tracking and queue depth metrics
  - Worker completion processing and queue draining
- [x] Write 56 deterministic Vitest unit tests (32 LoadBalancer + 24 AppServer):
  - **LoadBalancer**: server management (add/remove/stats), round-robin fairness, least-connections selection, weighted distribution ratios, health check failover, degraded server handling, connection tracking, configuration immutability, reset functionality, deterministic behavior across partitions
  - **AppServer**: basic request acceptance/rejection, worker management, queue overflow behavior (503 on full queue), latency degradation under increasing utilization, utilization metrics, configuration, reset/replay support, edge cases (zero workers, large queues, negative latency)
- [x] Export new modules from `sim-engine/src/index.ts`
- [x] All tests pass: 159 Vitest tests total, `tsc --noEmit` clean
- **Blockers:** None

---

### Day 6 — Saturday 2025-11-15 · Storage & Database Nodes
- [x] Implement `CacheNode` class supporting:
  - LRU (Least Recently Used) eviction policy
  - LFU (Least Frequently Used) eviction policy with tie-breaking by recency
  - Configurable capacity with deterministic eviction order
  - TTL expiration on virtual clock (per-entry or default)
  - Cache-aside and write-through operation modes
  - Hit/miss/eviction/expiration metrics via `CacheStats`
  - `processExpirations(currentTime)` batch expiration helper
- [x] Write 29 deterministic Vitest unit tests covering:
  - LRU eviction order and access-order updates
  - LFU eviction with frequency counting and LRU tie-breaking
  - TTL expiry via get() and processExpirations()
  - Per-entry TTL override
  - Statistics tracking (hits, misses, evictions, expirations, hit rate)
  - Configuration defaults and customization
  - Edge cases (capacity 1, large operations, overwrite existing keys)
- [x] Implement `DatabaseNode` class supporting:
  - Primary-replica topology with configurable replica count
  - Sync replication mode (immediate) vs async replication mode (delayed by lag)
  - Configurable read/write latency
  - Replication lag causing stale reads during lag windows
  - Connection pool with configurable max connections
  - `REJECTED_503` on pool exhaustion for both reads and writes
  - `processReplications(currentTime)` to advance async replications
  - Read/write/connection statistics
- [x] Write 26 deterministic Vitest unit tests covering:
  - Basic read/write operations
  - Sync replication completeness
  - Async replication pending state and completion
  - Stale read detection during replication lag
  - Connection pool exhaustion (503 rejection)
  - Connection release and pool availability
  - Statistics tracking
  - Edge cases (zero replicas, invalid replica index, rapid operations)
- [x] Export both modules from `sim-engine/src/index.ts`
- [x] All tests pass: 214 Vitest tests total (new: 55), `tsc --noEmit` clean, `npm run build` succeeds
- **Blockers:** None

---

### Day 6 — Saturday 2025-11-15 · Web app shell
- [ ] Create Vite + React 18 scaffold in `packages/web`
- [ ] Implement basic layout: scenario selector, start/pause/step controls, tick counter
- [ ] Connect WebSocket client to `/ws/sim`; render raw tick event log
- [ ] Verify `npm run dev:web` starts and connects to a concurrently-run API
- **Blockers:** None

---

### Day 7 — Sunday 2025-11-16 · Integration & reflection
- [ ] End-to-end smoke test: launch web → connect to API → trigger start → see ticks
- [ ] Verify snapshot round-trip works end-to-end (save at tick N, restore, continue)
- [ ] Update `PROGRESS.md` with Week 1 outcomes and notes for Week 2
- [ ] Record any technical debt or open questions in a `TODO.md` or GitHub issue
- **Blockers:** None

---

## Open Questions (for planning)

- [ ] Should the engine expose a WASM build target, or keep it Node-only for now?
- [ ] What PRNG algorithm balances speed + quality for distributed-simulation needs?
- [ ] Do we need concurrency inside the engine (multi-worker)? Start single-threaded.
- [ ] How many concurrent sessions should the API support per process/memory limits?

---

## Week 2 — Distributed Algorithms (2025-11-17 → 2025-11-23)

**Goal:** Implement core distributed algorithms and data structures in sim-engine, starting with consistent hashing for node placement.

---

### Day 2 — Monday 2025-11-17 · Raft Consensus Part 1 (Leader Election & Term Management)
- [x] Implement `RaftNode` class supporting Follower, Candidate, and Leader roles
- [x] Monotonic `currentTerm`, `votedFor`, deterministic randomized election timeouts via seeded PRNG on VirtualClock
- [x] `RequestVote` request/response RPC handling: lastLogTerm/lastLogIndex up-to-date log checks, step-down on higher term, split-vote timeout recovery
- [x] Periodic leader heartbeats (AppendEntries empty heartbeats) that reset follower election timers
- [x] Implement `RaftCluster` wiring multiple RaftNode instances over NetworkLink for network partition injection (asymmetric/symmetric)
- [x] Write 68 deterministic Vitest unit tests covering:
  - Initial leader election in 3- and 5-node clusters
  - Split-vote resolution with configurable jitter
  - Higher-term step-down behavior
  - Leader re-election after primary partition
  - Heartbeat timer reset
  - Determinism across identical seeds
- [x] Export Raft modules from `sim-engine/src/index.ts`
- [x] All tests pass: 321 total, `tsc --noEmit` clean, build succeeds
- **Blockers:** None

---

### Day 1 — Monday 2025-11-17 · Consistent Hash Ring
- [x] Implement `ConsistentHashRing` class in `packages/sim-engine/src/consistent_hashing/`
- [x] Support configurable virtual nodes (vnodes) per physical node (default: 150)
- [x] Implement FNV-1a 32-bit hash as primary algorithm
- [x] Implement Murmur-like mix as alternative hash function option
- [x] Key insight: pre-compute base hash from physical node ID, then XOR each vnode index byte individually before final hash — prevents sequential-index clustering
- [x] O(log V) binary-search lookup for `getNode(key)`
- [x] Replication support via `getNodes(key, count)` returning distinct physical nodes clockwise on ring
- [x] Dynamic `addNode()` / `removeNode()` methods computing approximate remapped fraction
- [x] Write 39 deterministic Vitest unit tests covering:
  - Construction & config validation
  - Node addition/removal/clear operations
  - Deterministic key-to-node assignment
  - Distinct physical replica selection
  - Uniform load distribution across vnode counts (verified < 15% stddev at 300 vnodes / 10 nodes)
  - Minimal key redistribution on node changes (bounded < 50% when adding/removing single node)
  - Hash algorithm variants producing different assignments
  - Edge cases (empty string, long keys, unicode, single vnode/node, multi-cycle add/remove)
- [x] Export from `sim-engine/src/index.ts`
- [x] Write ADR-002 explaining consistent hashing design decisions
- [x] All tests pass: 253 total, `tsc --noEmit` clean
- **Blockers:** None
