import type { Request, Response } from "express";
import { z } from "zod";
import * as schedulesService from "../services/schedules.service.js";
import { uuidParam } from "../lib/params.js";

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  cronExpression: z.string().min(1).max(100),
  timezone: z.string().max(64).optional(),
  jobName: z.string().min(1).max(200).trim(),
  payload: z.unknown().optional(),
});

export const setActiveSchema = z.object({
  isActive: z.boolean(),
});

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createScheduleSchema>;
  const schedule = await schedulesService.createSchedule(
    req.userId as string,
    uuidParam(req, "queueId"),
    body,
  );
  res.status(201).json({ schedule });
}

export async function list(req: Request, res: Response): Promise<void> {
  const schedules = await schedulesService.listSchedules(
    req.userId as string,
    uuidParam(req, "queueId"),
  );
  res.json({ schedules });
}

export async function setActive(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof setActiveSchema>;
  const schedule = await schedulesService.setScheduleActive(
    req.userId as string,
    uuidParam(req, "id"),
    body.isActive,
  );
  res.json({ schedule });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await schedulesService.deleteSchedule(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.status(204).send();
}
