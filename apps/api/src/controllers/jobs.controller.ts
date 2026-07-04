import type { Request, Response } from "express";
import { z } from "zod";
import * as jobsService from "../services/jobs.service.js";
import { getPagination, paginated } from "../lib/pagination.js";
import { uuidParam } from "../lib/params.js";
import { JOB_STATES } from "@jobs/core";

export const createJobSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  payload: z.unknown().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  runAt: z.string().datetime({ offset: true }).optional(),
  delaySeconds: z.number().int().min(1).max(31_536_000).optional(), // ≤ 1 year
  idempotencyKey: z.string().min(1).max(255).optional(),
  retryPolicyId: z.string().uuid().optional(),
});

export const createBatchSchema = z.object({
  name: z.string().max(200).optional(),
  retryPolicyId: z.string().uuid().optional(),
  jobs: z
    .array(
      z.object({
        name: z.string().min(1).max(200).trim(),
        payload: z.unknown().optional(),
        priority: z.number().int().min(-100).max(100).optional(),
      }),
    )
    .min(1)
    .max(1000), // sanity cap: batches are one transaction
});

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createJobSchema>;
  const { job, deduplicated } = await jobsService.createJob(
    req.userId as string,
    uuidParam(req, "queueId"),
    body,
  );
  // 200 (not 201) when the idempotency key matched an existing job.
  res.status(deduplicated ? 200 : 201).json({ job, deduplicated });
}

export async function createBatch(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createBatchSchema>;
  const { batch, jobs } = await jobsService.createBatch(
    req.userId as string,
    uuidParam(req, "queueId"),
    body,
  );
  res.status(201).json({ batch, jobCount: jobs.length });
}

export async function getBatch(req: Request, res: Response): Promise<void> {
  const result = await jobsService.getBatch(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json(result);
}

const stateFilter = z.enum(JOB_STATES).optional();

export async function list(req: Request, res: Response): Promise<void> {
  const p = getPagination(req);
  const state = stateFilter.safeParse(req.query.state);
  const filters = {
    state: state.success ? state.data : undefined,
    name: typeof req.query.name === "string" ? req.query.name : undefined,
  };
  const { rows, total } = await jobsService.listJobs(
    req.userId as string,
    uuidParam(req, "queueId"),
    filters,
    p,
  );
  res.json(paginated(rows, total, p));
}

export async function get(req: Request, res: Response): Promise<void> {
  const result = await jobsService.getJob(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json(result);
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const job = await jobsService.cancelJob(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json({ job });
}

export async function listDlq(req: Request, res: Response): Promise<void> {
  const p = getPagination(req);
  const { rows, total } = await jobsService.listDlq(
    req.userId as string,
    uuidParam(req, "queueId"),
    p,
  );
  res.json(paginated(rows, total, p));
}

export async function retryFromDlq(req: Request, res: Response): Promise<void> {
  const job = await jobsService.retryDlqJob(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json({ job });
}
