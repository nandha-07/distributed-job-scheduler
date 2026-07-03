import type { Request, Response } from "express";
import { z } from "zod";
import * as projectsService from "../services/projects.service.js";
import { getPagination, paginated } from "../lib/pagination.js";
import { uuidParam } from "../lib/params.js";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(1000).optional(),
  organizationId: z.string().uuid().optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field must be provided",
  });

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createProjectSchema>;
  const project = await projectsService.createProject(
    req.userId as string,
    body,
  );
  res.status(201).json({ project });
}

export async function list(req: Request, res: Response): Promise<void> {
  const p = getPagination(req);
  const { rows, total } = await projectsService.listProjects(
    req.userId as string,
    p,
  );
  res.json(paginated(rows, total, p));
}

export async function get(req: Request, res: Response): Promise<void> {
  const project = await projectsService.getProject(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.json({ project });
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof updateProjectSchema>;
  const project = await projectsService.updateProject(
    req.userId as string,
    uuidParam(req, "id"),
    body,
  );
  res.json({ project });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await projectsService.deleteProject(
    req.userId as string,
    uuidParam(req, "id"),
  );
  res.status(204).send();
}
