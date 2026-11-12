# Progress Tracker

This file records weekly milestones, daily tasks, and open questions. Update it as work progresses.

---

## Week 1 — Foundations (2025-11-10 → 2025-11-16)

**Goal:** Monorepo scaffold running, first minimal simulation loop functional, documentation baseline laid down.

---

### Day 1 — Monday 2025-11-10 · Repo scaffolding
- [x] Initialize pnpm/npm workspaces for `packages/sim-engine`, `packages/api`, `packages/web`
- [x] Create `CLAUDE.md` describing structure, tech stack, commands
- [x] Set up ESLint + Prettier presets shared across TS packages
- [x] Configure ruff/black for Python API package
- [ ] Add root `package.json` scripts (`build`, `test`, `lint`, `typecheck`, `dev:*`)
- [ ] ~~Run `npm install && npm run build` end-to-end (post-merge verification)~~
- **Blockers:** None

---

### Day 2 — Tuesday 2025-11-11 · Simulator core skeleton
- [ ] Define TypeScript types: `Event`, `ProcessState`, `Scenario`, `Snapshot`
- [ ] Implement `MinHeap<Event>` with `(time, seq)` lexicographic ordering
- [ ] Write unit tests for heap invariants (push/pop/peek)
- [ ] Implement bare-bones `DiscreteEventSimulator` class with `schedule()` and `step()`
- [ ] Ensure sim-engine builds with `tsc --noEmit` clean
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
- [ ] Define `SimpleLeaderElection` scenario shape (3 processes, timer-driven)
- [ ] Register it in `sim-engine/src/scenarios/index.ts`
- [ ] Run golden-path test: verify first three ticks produce expected event log
- [ ] Export scenario definitions via a stable JSON schema for future validation
- **Blockers:** None

---

### Day 5 — Friday 2025-11-14 · API stub + WebSocket heartbeat
- [ ] Scaffold FastAPI app in `packages/api/src/main.py`
- [ ] Implement `/health` endpoint returning `{"status":"ok"}`
- [ ] Add WebSocket endpoint `/ws/sim` accepting `{action, payload}` JSON
- [ ] Wire engine call into `/ws/sim/start` → returns initial tick events
- [ ] Run `pytest` smoke test against local API
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
