import type { Request, Response } from "express";
import { z } from "zod";
import * as queuesService from "../services/queues.service.js";
import { getPagination, paginated } from "../lib/pagination.js";
import { uuidParam } from "../lib/params.js";

export const createQueueSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  maxConcurrency: z.number().int().min(1).max(1000).optional(),
  defaultRetryPolicyId: z.string().uuid().optional(),
});

export const updateQueueSchema = createQueueSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field must be provided",
  });

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createQueueSchema>;
  const queue = await queuesService.createQueue(
    req.userId as string,
    uuidParam(req, "projectId"),
    body,
  );
  res.status(201).json({ queue });
}

export async function list(req: Request, res: Response): Promise<void> {
  const p = getPagination(req);
  const { rows, total } = await queuesService.listQueues(
    req.userId as string,
    uuidParam(req, "projectId"),
    p,
  );
  res.json(paginated(rows, total, p));
}

export async function get(req: Request, res: Response): Promise<void> {
  const queue = await queuesService.getQueue(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json({ queue });
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof updateQueueSchema>;
  const queue = await queuesService.updateQueue(
    req.userId as string,
    uuidParam(req, "id"),
    body,
  );
  res.json({ queue });
}

export async function pause(req: Request, res: Response): Promise<void> {
  const queue = await queuesService.setQueuePaused(
    req.userId as string,
    uuidParam(req, "id"),
    true,
  );
  res.json({ queue });
}

export async function resume(req: Request, res: Response): Promise<void> {
  const queue = await queuesService.setQueuePaused(
    req.userId as string,
    uuidParam(req, "id"),
    false,
  );
  res.json({ queue });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await queuesService.deleteQueue(req.userId as string, uuidParam(req, "id"));
  res.status(204).send();
}

export async function stats(req: Request, res: Response): Promise<void> {
  const s = await queuesService.getQueueStats(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json({ stats: s });
}
