/**
 * Retry policies business logic.
 */
import { retryPoliciesRepo } from "@jobs/db";
import type { RetryPolicyRow } from "@jobs/db";
import { requireProjectAccess } from "./access.service.js";

export async function createRetryPolicy(
  userId: string,
  projectId: string,
  params: {
    name: string;
    strategy: "fixed" | "linear" | "exponential";
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter?: boolean;
  },
): Promise<RetryPolicyRow> {
  await requireProjectAccess(userId, projectId, "admin");
  return retryPoliciesRepo.create({ projectId, ...params });
}

export async function listRetryPolicies(
  userId: string,
  projectId: string,
): Promise<RetryPolicyRow[]> {
  await requireProjectAccess(userId, projectId);
  return retryPoliciesRepo.listByProject(projectId);
}
