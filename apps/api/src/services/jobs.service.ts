/**
 * Jobs business logic: creation (immediate/delayed/scheduled/batch),
 * idempotency handling, retry snapshot resolution, explorer, cancel.
 */
import {
  batchesRepo,
  jobsRepo,
  pool,
  retryPoliciesRepo,
  withTransaction,
} from "@jobs/db";
import type { BatchRow, JobRow } from "@jobs/db";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  requireProjectAccess,
  requireQueueAccess,
} from "./access.service.js";

/** System fallback when neither the job nor the queue names a policy. */
const DEFAULT_RETRY = {
  maxAttempts: 3,
  retryStrategy: "exponential" as const,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 60_000,
};

interface RetrySnapshot {
  maxAttempts: number;
  retryStrategy: "fixed" | "linear" | "exponential";
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

/** Resolution order: explicit policy id → queue default → system default. */
async function resolveRetrySnapshot(
  projectId: string,
  retryPolicyId: string | undefined,
  queueDefaultPolicyId: string | null,
): Promise<RetrySnapshot> {
  const policyId = retryPolicyId ?? queueDefaultPolicyId;
  if (!policyId) return DEFAULT_RETRY;

  const policy = await retryPoliciesRepo.findById(policyId);
  if (!policy || policy.project_id !== projectId) {
    throw badRequest(
      "POLICY_PROJECT_MISMATCH",
      "Retry policy does not belong to this project",
    );
  }
  return {
    maxAttempts: policy.max_attempts,
    retryStrategy: policy.strategy,
    retryBaseDelayMs: policy.base_delay_ms,
    retryMaxDelayMs: policy.max_delay_ms,
  };
}

export interface CreateJobInput {
  name: string;
  payload?: unknown;
  priority?: number;
  runAt?: string; // ISO timestamp → scheduled
  delaySeconds?: number; // relative delay → scheduled
  idempotencyKey?: string;
  retryPolicyId?: string;
}

function resolveTiming(input: CreateJobInput): {
  state: "queued" | "scheduled";
  runAt?: Date;
} {
  if (input.runAt !== undefined && input.delaySeconds !== undefined) {
    throw badRequest(
      "AMBIGUOUS_TIMING",
      "Provide either runAt or delaySeconds, not both",
    );
  }
  if (input.runAt !== undefined) {
    const at = new Date(input.runAt);
    if (at.getTime() <= Date.now()) {
      // A past timestamp is just an immediate job.
      return { state: "queued" };
    }
    return { state: "scheduled", runAt: at };
  }
  if (input.delaySeconds !== undefined && input.delaySeconds > 0) {
    return {
      state: "scheduled",
      runAt: new Date(Date.now() + input.delaySeconds * 1_000),
    };
  }
  return { state: "queued" };
}

export async function createJob(
  userId: string,
  queueId: string,
  input: CreateJobInput,
): Promise<{ job: JobRow; deduplicated: boolean }> {
  const { queue, project } = await requireQueueAccess(userId, queueId);

  // Idempotency: if this key already created a job, return it — a client
  // retry after a network failure must not enqueue a duplicate.
  if (input.idempotencyKey) {
    const existing = await jobsRepo.findByIdempotencyKey(
      queueId,
      input.idempotencyKey,
    );
    if (existing) return { job: existing, deduplicated: true };
  }

  const retry = await resolveRetrySnapshot(
    project.id,
    input.retryPolicyId,
    queue.default_retry_policy_id,
  );
  const timing = resolveTiming(input);

  const job = await jobsRepo.create(pool, {
    queueId,
    name: input.name,
    payload: input.payload,
    priority: input.priority,
    state: timing.state,
    runAt: timing.runAt,
    idempotencyKey: input.idempotencyKey ?? null,
    ...retry,
  });
  return { job, deduplicated: false };
}

export interface BatchJobInput {
  name: string;
  payload?: unknown;
  priority?: number;
}

export async function createBatch(
  userId: string,
  queueId: string,
  input: { name?: string; jobs: BatchJobInput[]; retryPolicyId?: string },
): Promise<{ batch: BatchRow; jobs: JobRow[] }> {
  const { queue, project } = await requireQueueAccess(userId, queueId);
  const retry = await resolveRetrySnapshot(
    project.id,
    input.retryPolicyId,
    queue.default_retry_policy_id,
  );

  // Batch + all its jobs in ONE transaction: a batch is never half-created.
  return withTransaction(async (tx) => {
    const batch = await batchesRepo.create(tx, {
      projectId: project.id,
      name: input.name ?? null,
    });
    const jobs: JobRow[] = [];
    for (const j of input.jobs) {
      jobs.push(
        await jobsRepo.create(tx, {
          queueId,
          name: j.name,
          payload: j.payload,
          priority: j.priority,
          state: "queued",
          batchId: batch.id,
          ...retry,
        }),
      );
    }
    return { batch, jobs };
  });
}

export async function getBatch(userId: string, batchId: string) {
  const batch = await batchesRepo.findById(batchId);
  if (!batch) throw notFound("Batch");
  await requireProjectAccess(userId, batch.project_id).catch(() => {
    throw notFound("Batch");
  });
  return { batch, progress: await batchesRepo.progress(batchId) };
}

export async function listJobs(
  userId: string,
  queueId: string,
  filters: { state?: string; name?: string },
  p: { limit: number; offset: number },
) {
  await requireQueueAccess(userId, queueId);
  return jobsRepo.listByQueue(queueId, filters, p.limit, p.offset);
}

export async function getJob(userId: string, jobId: string) {
  const job = await jobsRepo.findById(jobId);
  if (!job) throw notFound("Job");
  await requireQueueAccess(userId, job.queue_id).catch(() => {
    throw notFound("Job");
  });
  const [executions, logs] = await Promise.all([
    jobsRepo.executionsForJob(jobId),
    jobsRepo.logsForJob(jobId),
  ]);
  return { job, executions, logs };
}

export async function cancelJob(
  userId: string,
  jobId: string,
): Promise<JobRow> {
  const job = await jobsRepo.findById(jobId);
  if (!job) throw notFound("Job");
  await requireQueueAccess(userId, job.queue_id).catch(() => {
    throw notFound("Job");
  });
  const cancelled = await jobsRepo.cancel(jobId);
  if (!cancelled) {
    throw conflict(
      "NOT_CANCELLABLE",
      `Job is '${job.state}' — only scheduled or queued jobs can be cancelled`,
    );
  }
  return cancelled;
}
