/**
 * Queues business logic.
 */
import { queuesRepo, retryPoliciesRepo } from "@jobs/db";
import type { QueueRow, QueueStats, ThroughputPoint } from "@jobs/db";
import { badRequest, notFound } from "../lib/errors.js";
import {
  requireProjectAccess,
  requireQueueAccess,
} from "./access.service.js";

/** A retry policy attached to a queue must belong to the same project. */
async function assertPolicyInProject(
  policyId: string,
  projectId: string,
): Promise<void> {
  const policy = await retryPoliciesRepo.findById(policyId);
  if (!policy || policy.project_id !== projectId) {
    throw badRequest(
      "POLICY_PROJECT_MISMATCH",
      "Retry policy does not belong to this project",
    );
  }
}

export async function createQueue(
  userId: string,
  projectId: string,
  params: {
    name: string;
    description?: string;
    priority?: number;
    maxConcurrency?: number;
    rateLimitPerSec?: number;
    defaultRetryPolicyId?: string;
  },
): Promise<QueueRow> {
  await requireProjectAccess(userId, projectId, "admin");
  if (params.defaultRetryPolicyId) {
    await assertPolicyInProject(params.defaultRetryPolicyId, projectId);
  }
  return queuesRepo.create({ projectId, ...params });
}

export async function listQueues(
  userId: string,
  projectId: string,
  p: { limit: number; offset: number },
) {
  await requireProjectAccess(userId, projectId);
  return queuesRepo.listByProject(projectId, p.limit, p.offset);
}

export async function getQueue(userId: string, queueId: string) {
  const { queue } = await requireQueueAccess(userId, queueId);
  return queue;
}

export async function updateQueue(
  userId: string,
  queueId: string,
  params: {
    name?: string;
    description?: string;
    priority?: number;
    maxConcurrency?: number;
    rateLimitPerSec?: number;
    defaultRetryPolicyId?: string;
  },
): Promise<QueueRow> {
  const { queue } = await requireQueueAccess(userId, queueId, "admin");
  if (params.defaultRetryPolicyId) {
    await assertPolicyInProject(params.defaultRetryPolicyId, queue.project_id);
  }
  const updated = await queuesRepo.update(queueId, params);
  if (!updated) throw notFound("Queue");
  return updated;
}

export async function setQueuePaused(
  userId: string,
  queueId: string,
  paused: boolean,
): Promise<QueueRow> {
  await requireQueueAccess(userId, queueId, "admin");
  const updated = await queuesRepo.setPaused(queueId, paused);
  if (!updated) throw notFound("Queue");
  return updated;
}

export async function deleteQueue(
  userId: string,
  queueId: string,
): Promise<void> {
  await requireQueueAccess(userId, queueId, "admin");
  await queuesRepo.remove(queueId);
}

export async function getQueueStats(
  userId: string,
  queueId: string,
): Promise<QueueStats> {
  await requireQueueAccess(userId, queueId);
  return queuesRepo.stats(queueId);
}

export async function getQueueThroughput(
  userId: string,
  queueId: string,
): Promise<ThroughputPoint[]> {
  await requireQueueAccess(userId, queueId);
  return queuesRepo.throughput(queueId);
}
