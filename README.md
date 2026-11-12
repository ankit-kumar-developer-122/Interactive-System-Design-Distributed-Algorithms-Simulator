# dist-sim — Interactive System Design & Distributed Algorithms Simulator

A monorepo for simulating distributed algorithms (consensus, consistency protocols, state machine replication) with an interactive web UI and a Python-backed API server. Built for education, debugging, and visualization of distributed systems behavior.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![Vitest](https://img.shields.io/badge/Vitest-2.x-green)

## 🎯 Purpose

This simulator helps you **learn**, **teach**, and **debug** distributed algorithms by providing:

- **Deterministic replay**: Given the same seed, runs are bit-for-bit reproducible
- **Interactive control**: Pause, step forward, rewind to any tick
- **Visual feedback**: See messages flow between nodes in real time
- **Protocol implementations**: Raft, Paxos, gossip, CRDTs, leader election, and more

## 🏗️ Repository Structure

```
packages/
  sim-engine/   # TypeScript core: discrete-event simulation engine
  api/          # Python FastAPI server: HTTP/WebSocket endpoints
  web/          # TypeScript React SPA: dashboard & visualizer
docs/
  ARCHITECTURE.md        # System design overview
  PROGRESS.md            # Development progress tracker
  adr/                   # Architecture Decision Records
    001-discrete-event-engine.md
CLAUDE.md                # Project conventions for AI assistants
README.md                # This file
pnpm-workspace.yaml      # Monorepo workspace config
tsconfig.base.json       # Shared TypeScript configuration
package.json             # Root package with workspace scripts
```

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) (auto-installed via corepack or `npm install -g pnpm`)
- [Python](https://www.python.org/) 3.11+ (for API package)

### Installation

```bash
# Clone the repository
git clone https://github.com/ankit-kumar-developer-122/Interactive-System-Design-Distributed-Algorithms-Simulator.git
cd Interactive-System-Design-Distributed-Algorithms-Simulator

# Enable pnpm (if not already enabled)
corepack enable

# Install all dependencies
pnpm install

# Build the simulator engine
pnpm run build
```

### Running the Application

```bash
# Run tests across all packages
pnpm run test

# Type-check TypeScript packages
pnpm run typecheck

# Run linting
pnpm run lint

# Start development servers
pnpm run dev:sim-engine   # Watch mode for simulator
pnpm run dev:api          # FastAPI with hot reload
pnpm run dev:web          # Vite dev server
```

## 🧠 Core Components

### `sim-engine` (TypeScript)

The heart of the system—a pure discrete-event simulation engine with no external dependencies:

- **`VirtualClock`**: Tracks simulated time independently of wall-clock time
- **`MinHeap<Event>`**: Priority queue ordered by `(time, seq)` for deterministic event processing
- **`Xorshift128Plus`**: Seedable PRNG with serializable state for exact replay
- **`SimulationEngine`**: Core engine supporting `step`, `fast`, and `realtime` pacing modes

#### Simpler Pacing Modes

| Mode | Description |
|------|-------------|
| `step` | Manual control—process exactly one event per `step()` call |
| `fast` | Run to completion as quickly as possible |
| `realtime` | Pace events at configured `tickMs` intervals |

### Snapshot Protocol

Snapshots capture full engine state for pause/resume/rewind functionality:

```typescript
interface Snapshot {
  clock: number;              // Virtual time at snapshot point
  events: Event[];            // Pending events (sorted heap)
  nodes: Map<number, NodeState>;  // Per-process states
  rngState: Uint32Array;      // PRNG state (256 bytes for Xorshift128+)
  seq: number;                // Global sequence counter
  tickCount: number;          // Steps taken so far
}
```

## 🔌 API Contract

The web app communicates with the simulator through the API layer using JSON over WebSocket:

| Action | Payload | Response |
|--------|---------|----------|
| `start` | `{ scenarioId, tickMs }` | Initial tick events |
| `pause` | `{}` | Acknowledged |
| `step` | `{}` | Next event |
| `resume` | `{}` | Acknowledged |
| `snapshot` | `{ tick }` | Full `Snapshot` object |
| `restore` | `{ snapshot }` | Acknowledged |

REST fallback endpoints:
- `GET /api/scenarios` — List available scenarios
- `GET /api/snapshots/:id` — Retrieve saved snapshot
- `POST /api/snapshots` — Save new snapshot

## 📐 Architecture Principles

### Determinism Guarantee

For identical inputs (same scenario + seed):
1. Every event has a precise `(time, seq)` pair
2. Events process in strict order
3. Randomness comes only from the seeded PRNG
4. Floating-point operations avoided where possible

### Package Dependencies Flow

```
web → api → sim-engine
         ↘ sim-engine
```

- `sim-engine`: Pure simulation logic, zero UI/API deps
- `api`: Thin wrapper around engine (FastAPI + Pydantic v2)
- `web`: Self-contained React SPA (no engine access)

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed design docs.

## 🧪 Testing

Run the full test suite:

```bash
# All packages
pnpm run test

# Simulator only (50 unit tests)
cd packages/sim-engine && pnpm test

# With coverage report
pnpm exec vitest run --coverage
```

Test categories:
- **MinHeap**: 11 tests covering ordering, tie-breaking, large-scale performance
- **VirtualClock**: 7 tests for time invariant enforcement
- **Xorshift128Plus**: 8 tests for determinism and round-trip serialization
- **SimulationEngine**: 24 tests for lifecycle, pacing, snapshots, and replay

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | Project conventions and commands |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture and design decisions |
| [PROGRESS.md](./docs/PROGRESS.md) | Milestone tracking |
| [ADR-001](./docs/adr/001-discrete-event-engine.md) | Min-heap vs setTimeout rationale |

## 🤝 Contributing

Contributions welcome! Please follow these guidelines:

1. **Commit messages**: Use [Conventional Commits](https://www.conventionalcommits.org/) format
2. **Code style**: ESLint + Prettier for TS, Ruff/black for Python
3. **Tests**: All changes require passing tests
4. **PRs**: Require at least one approving review

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

## 🔗 Links

- [GitHub Repository](https://github.com/ankit-kumar-developer-122/Interactive-System-Design-Distributed-Algorithms-Simulator)
- [Architecture Docs](./docs/ARCHITECTURE.md)
- [Progress Tracker](./docs/PROGRESS.md)
