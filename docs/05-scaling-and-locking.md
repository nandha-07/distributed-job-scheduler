# Distributed Locking & Scaling Design

## Distributed locking (implemented)

This system relies on three PostgreSQL locking mechanisms — locking is not a
bolt-on feature here, it is the core correctness strategy:

1. **Row locks with `FOR UPDATE SKIP LOCKED` (job claiming).** The claim
   query locks candidate job rows; competing workers skip locked rows and
   receive disjoint sets. This is lock-based mutual exclusion with zero
   waiting — proven by the duplicate-execution audit (0 duplicates across
   concurrent workers) and by the `claiming.integration.test.ts` race test.
2. **Advisory locks (migrations).** `pg_advisory_lock(727770)` in the
   migration runner is an application-defined mutex: two operators running
   `db:migrate` simultaneously serialize instead of interleaving DDL.
3. **Guarded transitions (optimistic concurrency).** Every state change is
   `UPDATE ... WHERE state = '<expected>'`. If another actor won the race,
   zero rows update and the caller backs off — e.g. a zombie worker cannot
   start a job the reaper already requeued.

Why not Redis/ZooKeeper locks? The database is already the single source of
truth (DD-005); its transactional locks are strictly stronger than a
separate lock service (no split-brain between lock store and data store).

## Queue sharding (design, deliberately not implemented)

At current scale (thousands of jobs/sec ceiling, DD-001) sharding is
unnecessary; implementing it would be complexity without benefit. The
design, should scale demand it:

1. **Shard key**: `queue_id` (jobs of one queue stay together, preserving
   per-queue ordering, concurrency caps and rate limits per shard).
2. **Shard map**: `hash(queue_id) mod N` → shard. Stored in a small
   control table so shards can be rebalanced by *reassigning queues*, not
   by moving individual jobs.
3. **Topology**: each shard is an independent Postgres database with the
   same schema (same migrations). Workers are assigned shard lists; the
   claim query runs per-shard, unchanged — SKIP LOCKED semantics are
   shard-local, so correctness is preserved without cross-shard locks.
4. **Cross-shard concerns**: the dashboard fans out stats queries and
   merges; workflow dependencies are constrained to same-project (already
   enforced), and projects are pinned to one shard, so no cross-shard
   dependency edges can exist.
5. **Migration path**: shard N=1 is exactly today's system — the design is
   additive, which is why deferring it costs nothing.
