# dist-sim — Interactive System Design & Distributed Algorithms Simulator

Monorepo for a TypeScript/Python project that simulates distributed algorithms (consensus, consistency protocols, state machine replication) with an interactive web UI and a Python-backed API server.

## Repository Layout

```
packages/
  sim-engine/   # TypeScript: pure discrete-event simulation core (no UI deps)
  api/          # Python FastAPI server: exposes simulations as HTTP/WebSocket endpoints
  web/          # TypeScript React app: interactive dashboard, visualizer, scenario library
docs/
  ARCHITECTURE.md
  PROGRESS.md
  adr/
```

## Monorepo Structure Rules

- `packages/sim-engine` owns **all** simulation logic. It must have zero dependencies on `packages/web` or `packages/api`. Imports flow one way: `api` → `sim-engine`, `web` → `sim-engine` (via shared types / compiled artifacts).
- `packages/api` is thin: it wires the simulator to HTTP/WebSocket transports only. No business logic.
- `packages/web` is a self-contained SPA. It talks to the API via REST/WebSocket; no direct access to the simulator.
- Shared types (e.g., protocol definitions, event shapes) live in `sim-engine/src/types/` and are published as the package's public API.

## Tech Stack

- `sim-engine`: TypeScript, ts-node/jest, pure ESM + CJS dual build output (`dist/`)
- `api`: Python 3.11+, FastAPI, Pydantic v2, Uvicorn
- `web`: TypeScript, React 18, Vite, WebSocket client

## Code Style

- ESLint + Prettier across TS packages. Ruff/black for Python.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- PRs require at least one approving review; CI must pass before merge.

## Commands

```bash
# From repo root
npm install                      # Install all workspace packages
npm run build                    # Build every package
npm run test                     # Test every package in parallel
npm run lint                     # Lint every package
npm run typecheck                # tsc --noEmit on TS packages

# Per-package shortcuts
npm run dev:sim-engine           # Watch mode for the simulator
npm run dev:api                  # Hot-reload FastAPI server (uvicorn main:app --reload)
npm run dev:web                  # Vite dev server, proxying /api → localhost:8000

# Tests
npx jest --selectProjects sim-engine  # Simulator unit tests only
python -m pytest packages/api/tests     # API integration tests
npx vitest run                              # Web component/unit tests
```

## Simulator API Contract (web ↔ api ↔ engine)

The web app drives the simulator through the API using these message shapes:

| Action | Payload |
|--------|---------|
| `start` | `{ scenarioId: string, tickMs: number }` |
| `pause` | `{}` |
| `step` | `{}` |
| `resume` | `{}` |
| `snapshot` | `{ tick: number }` — returns full simulator state for replay |
| `restore` | `{ snapshot: Snapshot }` — restores previous state exactly |

All communication uses JSON over WebSocket; fallback REST GET/POST supported for `/api/scenarios` and `/api/snapshots`.
