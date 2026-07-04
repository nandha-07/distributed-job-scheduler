# Architecture — Distributed Job Scheduler

> Status: Draft v1 (Phase 1). Living document — updated as milestones complete.

## 1. System overview

A distributed job scheduling platform: clients create background jobs via a REST
API; multiple worker processes claim and execute those jobs reliably; a web
dashboard provides observability and control.

```
                        ┌────────────────────────────┐
                        │        React Dashboard     │
                        │  queues · jobs · workers   │
                        └──────────────┬─────────────┘
                                       │ HTTPS (REST, JWT)
                                       ▼
┌──────────────┐        ┌────────────────────────────┐
│  Scheduler    │       │         API Server         │
│  (1 process)  │       │  auth · validation · CRUD  │
│               │       │  job submission · metrics  │
└──────┬───────┘        └──────────────┬─────────────┘
       │ promotes due                   │ reads/writes
       │ delayed & cron jobs            ▼
       │                ┌────────────────────────────┐
       └─────────────▶  │         PostgreSQL         │
                        │  system of record + queue  │
                        │  (FOR UPDATE SKIP LOCKED)  │
                        └──────────────┬─────────────┘
                                       │ poll · claim · heartbeat
                        ┌──────────────┴─────────────┐
                        │     Worker fleet (N procs) │
                        │  claim → execute → report  │
                        └────────────────────────────┘
```

## 2. Processes and why they are separate

| Process | Responsibility | Scaling driver | Failure isolation |
|---|---|---|---|
| API server | HTTP, auth, validation, job submission, dashboard queries | user traffic | worker crash never takes down the API |
| Worker (×N) | poll queues, atomically claim jobs, execute with per-queue concurrency limits, heartbeat, graceful shutdown | job volume | one worker dying only delays its in-flight jobs, which are recovered via heartbeat timeout |
| Scheduler | tick loop that moves due delayed/scheduled jobs to `queued` and materializes cron occurrences | none (single light process) | if down, jobs are late, never lost — state lives in Postgres |

Communication between processes is **only through PostgreSQL**. No process
calls another directly. This removes an entire class of failure modes
(service discovery, partial network failures between our own services).

## 3. Key design decisions (summary — full rationale in 02-design-decisions.md)

1. **PostgreSQL as both database and queue.** The schema requirements,
   atomic-claim requirement, and dashboard queryability all point at a
   relational store. `FOR UPDATE SKIP LOCKED` gives contention-free atomic
   claiming. Prior art: Oban, pg-boss, Solid Queue, Graphile Worker.
2. **Node.js + TypeScript** across backend and frontend. One language, static
   types shared end to end, async I/O model fits an I/O-bound queue system.
3. **Monorepo (npm workspaces)**: three runnable apps + shared packages,
   preventing drift between processes.
4. **Layered architecture** in the API: routes → controllers → services →
   repositories. SQL only in repositories; business rules only in services.
5. **Polling, not pub/sub, for workers** (with short adaptive intervals).
   Simple, robust, and sufficient at assignment scale; documented upgrade
   path is Postgres `LISTEN/NOTIFY`.

## 4. Repository layout

```
job-scheduler/
├── apps/
│   ├── api/          # REST API server (Express)
│   │   └── src/
│   │       ├── routes/        # URL → controller wiring
│   │       ├── controllers/   # HTTP parsing/responses only
│   │       ├── services/      # business logic
│   │       ├── middleware/    # auth, validation, error handler
│   │       └── index.ts
│   ├── worker/       # job executor process
│   │   └── src/
│   │       ├── poller.ts      # claim loop
│   │       ├── executor.ts    # runs job handlers w/ concurrency limits
│   │       ├── heartbeat.ts
│   │       └── index.ts
│   ├── scheduler/    # cron/delayed job promoter
│   │   └── src/
│   └── dashboard/    # React + Vite frontend
│       └── src/
├── packages/
│   ├── db/           # migrations, repositories, connection pool
│   ├── core/         # shared domain types, job state machine, retry math
│   └── config/       # env loading + validation (single source of truth)
├── docs/             # this folder: architecture, DB, API, decisions
├── docker-compose.yml  # local PostgreSQL
└── package.json        # npm workspaces root
```

Why each module exists:

- **apps/api** — the only public entry point; owns authn/authz and validation.
- **apps/worker** — the only component that executes jobs; deliberately has no
  HTTP surface (reduces attack surface, scales horizontally).
- **apps/scheduler** — time-based state transitions kept out of workers so a
  busy fleet can never starve the clock.
- **packages/db** — one place for SQL and migrations; every process shares the
  same repository code, so a schema change is made exactly once.
- **packages/core** — the domain vocabulary (Job, Queue, RetryPolicy, state
  machine). Pure functions, no I/O, fully unit-testable.
- **packages/config** — every env variable declared and validated once;
  a missing variable fails fast at boot instead of at 2 a.m. in production.

## 5. Job lifecycle (state machine)

```
            (delayed/cron)                    heartbeat lost /
  create ──► scheduled ──► queued ──► claimed ──► running ──► completed
                 ▲            ▲          │            │
                 │            │          ▼            ▼
                 │            └─── (stale reclaim)  failed
                 │                                    │ retries left?
                 │           yes: back to scheduled ◄─┤ (per retry policy)
                 │                                    │ no:
                 └────────────────────────────────────► dead_letter
```

Every transition is a single SQL transaction and is recorded in an executions
history table — this is what makes retry history and audit trails possible.

## 6. Reliability model (what can go wrong, and our answer)

| Failure | Mitigation |
|---|---|
| Two workers grab the same job | `FOR UPDATE SKIP LOCKED` claim inside a transaction — claiming is atomic by construction |
| Worker crashes mid-job | heartbeats; a reaper marks workers stale after a timeout and re-queues their claimed/running jobs |
| Job fails transiently | configurable retry policies: fixed / linear / exponential backoff (+ max attempts) |
| Job fails permanently | moved to Dead Letter Queue with full error history; manual retry from dashboard |
| Scheduler down | jobs become late, never lost — all schedule state persists in Postgres |
| Duplicate execution after crash | at-least-once delivery documented; handlers written idempotently; execution records enable detection |

## 7. Observability

- Structured JSON logging (pino) in every process, correlation IDs per request/job.
- Per-queue statistics (depth, throughput, failure rate) computed from SQL.
- Worker health from heartbeat recency.
- Dashboard renders all of the above; live updates via polling (documented
  upgrade path: WebSockets).

## 8. Technology stack

| Layer | Choice | Version policy |
|---    |--      |---             |
| Runtime | Node.js LTS | ≥ 22 |
| Language | TypeScript (strict mode) | latest 5.x |
| API framework | Express | 4.x |
| Validation | Zod | shared between API and config |
| DB | PostgreSQL | 16, via Docker |
| DB access | node-postgres (pg) + hand-written SQL migrations | no ORM — SQL skills are being evaluated |
| Logging | pino | |
| Frontend | React + Vite + TypeScript | |
| Testing | Vitest + Supertest | |
| Local infra | Docker Compose (Postgres only) | |

## 9. Roadmap

| # | Milestone | Key outcomes |
|---|---|---|
| M1 | Architecture & planning | this document, decisions doc |
| M2 | Dev environment & scaffold | Node, Docker Postgres, monorepo boots |
| M3 | Database design | ER diagram, migrations, index rationale |
| M4 | Auth + projects/queues API | JWT auth, CRUD, validation, errors |
| M5 | Job APIs | immediate/delayed/scheduled/cron/batch |
| M6 | Worker service | atomic claim, concurrency, heartbeats, graceful shutdown |
| M7 | Scheduler, retries, DLQ | backoff strategies, dead lettering, recovery |
| M8 | Dashboard | queue health, job explorer, worker monitor, metrics |
| M9 | Tests, docs, polish | critical-path tests, diagrams, API docs |
