# Database Design

> Companion to `packages/db/migrations/001_initial_schema.sql`.

## 1. Entity overview

| Table | Purpose | PK type |
|---|---|---|
| users | accounts, login credentials (hash only, never plaintext) | uuid |
| organizations | top-level tenant; owns projects | uuid |
| organization_members | user↔org membership + role (RBAC-ready) | composite (org_id, user_id) |
| projects | grouping of queues; belongs to one org | uuid |
| retry_policies | named, reusable retry configurations per project | uuid |
| queues | job channels: priority, concurrency limit, pause flag | uuid |
| schedules | recurring (cron) job definitions; spawn jobs per occurrence | uuid |
| batches | groups jobs submitted together | uuid |
| jobs | THE central table — one row per unit of work | uuid |
| job_executions | one row per execution attempt (history) | uuid |
| job_logs | log lines emitted during execution | bigserial |
| workers | registered worker processes + liveness state | uuid |
| worker_heartbeats | heartbeat history with utilization metrics | bigserial |
| dead_letter_entries | permanently failed jobs parked for inspection | uuid |

## 2. Relationships & cardinality

- users N:M organizations, through `organization_members` — a **composite
  primary key** `(organization_id, user_id)`: membership itself is the
  identity; a surrogate id would add nothing and permit duplicate rows.
- organizations 1:N projects 1:N queues 1:N jobs — the tenancy chain.
  Authorization walks this chain: "can user U touch job J?" = "is U a member
  of J.queue.project.organization?"
- jobs 1:N job_executions 1:N job_logs — full audit trail per attempt.
- jobs 1:1 dead_letter_entries — a job dead-letters at most once (UNIQUE FK).
- workers 1:N worker_heartbeats; jobs.claimed_by → workers.

## 3. Primary key strategy

**uuid (`gen_random_uuid()`)** for every externally visible entity:
non-guessable in URLs, generatable by any process without coordination
(essential in distributed systems), mergeable across environments.
Trade-off: 16 bytes vs 8, and random inserts scatter across the B-tree.

**bigserial** for `job_logs` and `worker_heartbeats`: append-only,
high-volume, never exposed in URLs, always accessed *through* their parent.
Sequential ids keep these hot tables compact and insert-friendly.
Knowing when to use each is the point — not dogma either way.

## 4. Normalization stance

Schema is 3NF: every fact lives in one place (queue name only in queues,
worker hostname only in workers, etc.).

**Deliberate denormalization #1 — retry snapshot on jobs.**
`max_attempts, retry_strategy, retry_base_delay_ms, retry_max_delay_ms` are
copied from the queue's policy at job creation. Editing a policy must not
change the behavior of jobs already in flight; behavior-at-creation-time is
itself a fact about the job. (`retry_policies` remains the normalized source
for *configuring* queues.)

**Deliberate denormalization #2 — `queue_id` on dead_letter_entries.**
Duplicates `jobs.queue_id` so the DLQ browser ("dead jobs in queue X,
newest first") is one indexed scan with no join.

## 5. State columns: TEXT + CHECK instead of native ENUM

Postgres `CREATE TYPE ... AS ENUM` makes adding/removing values a
migration headache (values can't be dropped; adding mid-list is awkward).
`text` + `CHECK (state IN (...))` gives identical integrity and trivially
evolvable constraints. The authoritative state list lives in
`packages/core/src/job-state.ts`; the CHECK mirrors it.

## 6. Index catalogue (every index maps to a real query)

| Index | Serves |
|---|---|
| `jobs_claim_idx (queue_id, priority DESC, run_at) WHERE state='queued'` | worker claim query — partial: ignores the millions of finished jobs |
| `jobs_promote_idx (run_at) WHERE state='scheduled'` | scheduler tick: "which delayed jobs are now due?" |
| `jobs_queue_state_idx (queue_id, state)` | queue statistics & dashboard counts |
| `jobs_claimed_by_idx (claimed_by) WHERE state IN ('claimed','running')` | reaper: find jobs held by a dead worker |
| `jobs_idempotency_idx UNIQUE (queue_id, idempotency_key) WHERE key IS NOT NULL` | duplicate-submission protection |
| `jobs_batch_idx (batch_id) WHERE batch_id IS NOT NULL` | batch progress view |
| `jobs_list_idx (queue_id, created_at DESC)` | job explorer default listing/pagination |
| `job_executions (job_id, attempt DESC)` | retry history per job |
| `job_logs (job_id, created_at)` | log viewer |
| `worker_heartbeats (worker_id, recorded_at DESC)` | worker detail charts |
| `workers_heartbeat_idx (last_heartbeat_at) WHERE state IN ('online','draining')` | reaper: find stale workers |
| `schedules_due_idx (next_run_at) WHERE is_active` | scheduler tick: due cron schedules |
| `dead_letter_entries (queue_id, moved_at DESC)` | DLQ browser |
| `users lower(email) UNIQUE` | case-insensitive login/uniqueness |

FKs used in joins/filters get supporting indexes; unused hypothetical
indexes are omitted (every index taxes every write).

## 7. Cascade rules (what happens on delete)

| Relationship | Rule | Why |
|---|---|---|
| org → projects → queues → jobs → executions → logs | ON DELETE CASCADE | tenant deletion removes the whole tree; no orphans |
| jobs.claimed_by → workers | ON DELETE SET NULL | deleting a worker record must not delete its jobs |
| queues.default_retry_policy_id → retry_policies | ON DELETE SET NULL | policy deletion falls back to defaults; queue survives |
| jobs.schedule_id / batch_id | ON DELETE SET NULL | spawned jobs are history; keep them if the template goes |

Rule of thumb: **ownership cascades; references null out.**

## 8. Concurrency & locking strategy (implemented in M6, designed now)

- Claiming: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n` inside a
  transaction. `FOR UPDATE` locks candidate rows; `SKIP LOCKED` makes
  competing workers skip already-locked rows instead of waiting —
  contention-free fan-out with zero duplicate claims.
- Every state transition = one transaction, guarded by
  `WHERE state = <expected>` (optimistic check against races).
- All timestamps are `timestamptz` (UTC on the wire, no DST bugs).

## 9. Performance & scaling notes

- Partial indexes keep hot paths O(active jobs), not O(all jobs ever).
- `payload jsonb`: binary JSON, per-job arbitrary data without EAV tables.
- Growth paths (documented, not premature): partition `jobs` by month once
  >10M rows; archive terminal jobs to a cold table; `job_logs` is the
  first candidate for retention policies.

## 10. Migration strategy

- Ordered SQL files in `packages/db/migrations/` (`001_...`, `002_...`).
- Runner (`npm run db:migrate`): records applied versions in
  `schema_migrations`, applies each pending file in its own transaction
  (all-or-nothing), and holds a Postgres advisory lock so two concurrent
  runners can never interleave.
- Forward-only: mistakes are fixed by a new migration, never by editing an
  applied file (applied files are history, like Git commits).
