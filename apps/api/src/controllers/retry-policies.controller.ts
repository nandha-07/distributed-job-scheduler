import type { Request, Response } from "express";
import { z } from "zod";
import * as retryPoliciesService from "../services/retry-policies.service.js";
import { uuidParam } from "../lib/params.js";

export const createRetryPolicySchema = z
  .object({
    name: z.string().min(1).max(100).trim(),
    strategy: z.enum(["fixed", "linear", "exponential"]),
    maxAttempts: z.number().int().min(1).max(100),
    baseDelayMs: z.number().int().min(0).max(3_600_000),
    maxDelayMs: z.number().int().min(0).max(86_400_000),
    jitter: z.boolean().optional(),
  })
  .refine((b) => b.maxDelayMs >= b.baseDelayMs, {
    message: "maxDelayMs must be >= baseDelayMs",
    path: ["maxDelayMs"],
  });

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createRetryPolicySchema>;
  const policy = await retryPoliciesService.createRetryPolicy(
    req.userId as string,
    uuidParam(req, "projectId"),
    body,
  );
  res.status(201).json({ policy });
}

export async function list(req: Request, res: Response): Promise<void> {
  const policies = await retryPoliciesService.listRetryPolicies(
    req.userId as string,
    uuidParam(req, "projectId"),
  );
  res.json({ policies });
}
