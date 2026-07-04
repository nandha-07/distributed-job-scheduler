/**
 * Integration tests for the CRITICAL reliability paths, against a real
 * PostgreSQL (uses DATABASE_URL from .env — the local docker instance).
 * Skips itself cleanly when no database is reachable.
 *
 * Isolation: creates its own org → project → queue with random names and
 * deletes the org at the end (M3's ON DELETE CASCADE cleans everything).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, closePool, jobsRepo, jobExecRepo, workersRepo, dlqRepo } from "../src/index.js";

const canConnect = await pool.query("SELECT 1").then(() => true, () => false);

const d = describe.skipIf(!canConnect);

let orgId: string, projectId: string, queueId: string, workerId: string;
const RETRY = {
  maxAttempts: 3,
  retryStrategy: "exponential" as const,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 60_000,
};

beforeAll(async () => {
  if (!canConnect) return;
  const suffix = Math.random().toString(36).slice(2, 8);
  orgId = (await pool.query(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`test-org-${suffix}`],
  )).rows[0].id;
  projectId = (await pool.query(
    "INSERT INTO projects (organization_id, name) VALUES ($1, $2) RETURNING id",
    [orgId, `test-project-${suffix}`],
  )).rows[0].id;
  queueId = (await pool.query(
    "INSERT INTO queues (project_id, name, max_concurrency) VALUES ($1, $2, 50) RETURNING id",
    [projectId, `test-queue-${suffix}`],
  )).rows[0].id;
  workerId = (await workersRepo.register({
    name: `test-worker-${suffix}`, hostname: "test", pid: 0, maxConcurrency: 50,
  })).id;
});

afterAll(async () => {
  if (canConnect && orgId) {
    await pool.query("DELETE FROM organizations WHERE id = $1", [orgId]); // cascades
    await pool.query("DELETE FROM workers WHERE id = $1", [workerId]);
  }
  await closePool();
});

d("atomic claiming", () => {
  it("concurrent claimers never receive the same job", async () => {
    for (let i = 0; i < 10; i++) {
      await jobsRepo.create(pool, { queueId, name: "send-email", state: "queued", ...RETRY });
    }
    // 5 simultaneous claim batches racing for 10 jobs. SKIP LOCKED may
    // UNDER-claim in a single simultaneous burst (racers skip each other's
    // locked rows without substituting) — that's by design; workers poll
    // again. So: burst, then sweep the leftovers, then assert.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => jobExecRepo.claimJobs(workerId, 4)),
    );
    const ids = results.flat().map((j) => j.id);
    for (let i = 0; i < 5 && ids.length < 10; i++) {
      const sweep = await jobExecRepo.claimJobs(workerId, 10);
      ids.push(...sweep.map((j) => j.id));
    }
    expect(new Set(ids).size).toBe(ids.length); // ZERO duplicates — the critical property
    expect(ids.length).toBe(10); // and nothing lost after the sweep
  });
});

d("dependency gating", () => {
  it("dependent jobs are invisible until the dependency completes", async () => {
    const a = await jobsRepo.create(pool, { queueId, name: "step-a", state: "queued", ...RETRY });
    const b = await jobsRepo.create(pool, { queueId, name: "step-b", state: "queued", ...RETRY });
    await jobsRepo.addDependencies(pool, b.id, [a.id]);

    const first = await jobExecRepo.claimJobs(workerId, 10);
    expect(first.map((j) => j.id)).toContain(a.id);
    expect(first.map((j) => j.id)).not.toContain(b.id);

    await pool.query("UPDATE jobs SET state = 'completed' WHERE id = $1", [a.id]);
    const second = await jobExecRepo.claimJobs(workerId, 10);
    expect(second.map((j) => j.id)).toContain(b.id);
  });
});

d("retry and dead-letter flow", () => {
  it("failJob with nextRunAt reschedules; without it dead-letters + DLQ entry; manual retry resets budget", async () => {
    const job = await jobsRepo.create(pool, { queueId, name: "flaky", state: "queued", ...RETRY });
    await jobExecRepo.claimJobs(workerId, 50);
    const started = await jobExecRepo.startExecution(job.id, workerId);
    expect(started).not.toBeNull();

    // Attempt 1 fails with a retry scheduled.
    await jobExecRepo.failJob({
      jobId: job.id, executionId: started!.execution.id, queueId,
      attemptsUsed: 1, errorMessage: "boom", nextRunAt: new Date(Date.now() + 50),
    });
    let row = await jobsRepo.findById(job.id);
    expect(row!.state).toBe("scheduled");

    // Promote + run attempt 2, exhaust the budget → DLQ.
    await pool.query("UPDATE jobs SET state = 'queued', run_at = now() WHERE id = $1", [job.id]);
    await jobExecRepo.claimJobs(workerId, 50);
    const s2 = await jobExecRepo.startExecution(job.id, workerId);
    await jobExecRepo.failJob({
      jobId: job.id, executionId: s2!.execution.id, queueId,
      attemptsUsed: 3, errorMessage: "boom final", nextRunAt: null,
    });
    row = await jobsRepo.findById(job.id);
    expect(row!.state).toBe("dead_letter");

    const dlq = await dlqRepo.listByQueue(queueId, 10, 0);
    expect(dlq.rows.some((e) => e.job_id === job.id)).toBe(true);

    // Manual retry: fresh budget, historical execution numbering continues.
    const retried = await dlqRepo.retryFromDlq(job.id, null as unknown as string);
    expect(retried).not.toBeNull();
    expect(retried!.state).toBe("queued");
    expect(retried!.attempts).toBe(0);

    await jobExecRepo.claimJobs(workerId, 50);
    const s3 = await jobExecRepo.startExecution(job.id, workerId);
    expect(s3).not.toBeNull();
    expect(s3!.execution.attempt).toBe(3); // max(historical)+1, not a repeat of 1
  });
});

d("rate limiting", () => {
  it("caps claims per queue per rolling second", async () => {
    const q2 = (await pool.query(
      "INSERT INTO queues (project_id, name, max_concurrency, rate_limit_per_sec) VALUES ($1, 'rl-queue', 50, 2) RETURNING id",
      [projectId],
    )).rows[0].id;
    for (let i = 0; i < 6; i++) {
      await jobsRepo.create(pool, { queueId: q2, name: "rl-job", state: "queued", ...RETRY });
    }
    const got = await jobExecRepo.claimJobs(workerId, 50);
    const mine = got.filter((j) => j.queue_id === q2);
    expect(mine.length).toBeLessThanOrEqual(2);
  });
});
