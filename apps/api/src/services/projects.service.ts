/**
 * Projects business logic.
 */
import { orgsRepo, projectsRepo } from "@jobs/db";
import type { ProjectRow } from "@jobs/db";
import { badRequest, notFound } from "../lib/errors.js";
import { requireProjectAccess } from "./access.service.js";

export async function createProject(
  userId: string,
  params: { name: string; description?: string; organizationId?: string },
): Promise<ProjectRow> {
  const orgs = await orgsRepo.listForUser(userId);
  let orgId = params.organizationId;
  if (orgId) {
    // If the client names an org, they must belong to it.
    if (!orgs.some((o) => o.id === orgId)) throw notFound("Organization");
  } else {
    // Default: the user's first organization (everyone has one — created
    // at registration).
    orgId = orgs[0]?.id;
    if (!orgId) throw badRequest("NO_ORGANIZATION", "User has no organization");
  }
  return projectsRepo.create({
    organizationId: orgId,
    name: params.name,
    description: params.description ?? null,
  });
}

export async function listProjects(
  userId: string,
  p: { limit: number; offset: number },
) {
  return projectsRepo.listForUser(userId, p.limit, p.offset);
}

export async function getProject(userId: string, projectId: string) {
  return requireProjectAccess(userId, projectId);
}

export async function updateProject(
  userId: string,
  projectId: string,
  params: { name?: string; description?: string },
): Promise<ProjectRow> {
  await requireProjectAccess(userId, projectId);
  const updated = await projectsRepo.update(projectId, params);
  if (!updated) throw notFound("Project");
  return updated;
}

export async function deleteProject(
  userId: string,
  projectId: string,
): Promise<void> {
  await requireProjectAccess(userId, projectId);
  await projectsRepo.remove(projectId);
}
