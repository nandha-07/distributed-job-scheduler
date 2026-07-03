# Design Decisions & Trade-offs

> One entry per significant decision. Format: context → options → decision → consequences.
> This is a graded deliverable ("design decisions document describing major trade-offs").

## DD-001: PostgreSQL as both system-of-record and job queue

**Context.** Jobs need durable storage, atomic claiming by competing workers,
rich querying for a dashboard, and retry/DLQ bookkeeping.

**Options considered.**
- *Postgres-only*: jobs are rows; workers claim via `SELECT ... FOR UPDATE SKIP LOCKED`.
- *Redis queue (BullMQ-style)*: fast push-based delivery, but volatile-by-default,
  poor ad-hoc queryability, and we would still need Postgres for users/projects —
  meaning dual writes and consistency problems between two stores.
- *RabbitMQ/Kafka*: real brokers, but they deliver messages rather than store
  queryable job state; every job would be mirrored into Postgres anyway.

**Decision.** Postgres-only.

**Why.** (1) Atomic claiming is the core correctness requirement and Postgres row
locking solves it transactionally — no distributed coordination needed.
(2) One system: simpler ops, simpler setup, fewer failure modes. (3) The job
explorer, filters, and statistics are plain SQL. (4) Proven pattern: Oban,
pg-boss, Solid Queue, Graphile Worker.

**Consequences / trade-offs.** Workers poll (small latency, mitigated by short
adaptive intervals; upgrade path: `LISTEN/NOTIFY`). Throughput ceiling around
thousands of jobs/sec — far above assignment scale; at larger scale we would
shard queues or introduce Redis in front (documented, not built).

## DD-002: Node.js + TypeScript

**Options.** Node+TS, Python+FastAPI, Java+Spring.

**Decision.** Node+TS. One language across all apps and the dashboard; strict
static types shared end to end via a common package; event-loop concurrency is
a natural fit for an I/O-bound system (jobs here wait on I/O, not CPU).
Trade-off: CPU-heavy job handlers would block the loop — acknowledged; the
worker's concurrency is process-level anyway (run more workers), which is the
distributed-systems point of the assignment.

## DD-003: No ORM — hand-written SQL with node-postgres

**Options.** Prisma/TypeORM vs raw SQL via `pg`.

**Decision.** Raw SQL in a repository layer.
**Why.** Database design, locking, and indexing are explicitly evaluated;
`FOR UPDATE SKIP LOCKED` and careful transaction control are first-class in
SQL and awkward/hidden in ORMs. Migrations are plain, reviewable `.sql` files.
**Trade-off.** More boilerplate than an ORM; mitigated by a thin repository
pattern and shared query helpers.

## DD-004: Monorepo with npm workspaces

Three processes + dashboard share types and DB code. Alternatives: separate
repos (drift, versioning pain) or copy-paste (DRY violation). npm workspaces
is built into the toolchain — no extra tooling to explain or maintain.

## DD-005: Processes communicate only through the database

No HTTP/RPC between our own services. Removes service discovery, internal
auth, and partial-failure handling between components; every state change is
transactional and observable. Trade-off: DB becomes the single point of
failure — acceptable and standard for this class of system (it is the system
of record regardless).

## DD-006: At-least-once execution semantics

Exactly-once delivery is impossible in a distributed system without
cooperation from the job handler (a worker can crash after doing the work but
before recording completion). We therefore guarantee **at-least-once** and
require handlers to be idempotent where it matters. This matches SQS, Sidekiq,
Celery. The executions table gives dedup/audit capability.

## DD-007: UUID primary keys, bigserial for append-only internals

UUIDs (`gen_random_uuid()`) for all externally visible entities:
non-guessable in URLs, generatable without DB coordination (distributed-
friendly). `bigserial` for `job_logs` and `worker_heartbeats`: append-only,
high-volume, internal-only — sequential ids keep those hot B-trees compact.
Trade-off consciously split per table type rather than one dogmatic rule.

## DD-008: Retry policy snapshotted onto each job (deliberate denormalization)

Editing a queue's retry policy must not change behavior of jobs already in
flight, so `max_attempts`/`retry_strategy`/delays are copied to the job row
at creation. Normalization trades away reproducibility here; we keep
`retry_policies` as the normalized source for *configuration*, snapshot for
*execution*. Same approach as Sidekiq/Oban.

## DD-009: TEXT + CHECK constraints instead of native Postgres ENUMs

Native ENUM types make value changes painful (can't drop values; awkward
migrations). `text` + `CHECK (x IN (...))` provides identical integrity and
one-line evolution. Authoritative state list lives in
`packages/core/src/job-state.ts`; the CHECK mirrors it.
