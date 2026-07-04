/**
 * Authorization primitives (RBAC).
 *
 * Membership check stays 404-on-no-access (anti-enumeration). Once a user
 * IS a member, insufficient role is an honest 403: they may know the
 * resource exists, they just can't do that to it.
 *
 * Role ranks: member(1) < admin(2) < owner(3).
 *  - member: read everything, create/cancel jobs
 *  - admin:  manage queues, schedules, retry policies, DLQ retries
 *  - owner:  delete projects, org administration
 */
import { orgsRepo, projectsRepo, queuesRepo } from "@jobs/db";
import type { OrgRole, ProjectRow, QueueRow } from "@jobs/db";
import { forbidden, notFound } from "../lib/errors.js";

const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export async function requireProjectAccess(
  userId: string,
  projectId: string,
  minRole: OrgRole = "member",
): Promise<ProjectRow> {
  const project = await projectsRepo.findById(projectId);
  if (!project) throw notFound("Project");
  const role = await orgsRepo.getRole(userId, project.organization_id);
  if (!role) throw notFound("Project"); // deliberate 404, not 403
  if (RANK[role] < RANK[minRole]) {
    throw forbidden(`This action requires the '${minRole}' role (you are '${role}')`);
  }
  return project;
}

export async function requireQueueAccess(
  userId: string,
  queueId: string,
  minRole: OrgRole = "member",
): Promise<{ queue: QueueRow; project: ProjectRow }> {
  const queue = await queuesRepo.findById(queueId);
  if (!queue) throw notFound("Queue");
  const project = await requireProjectAccess(
    userId,
    queue.project_id,
    minRole,
  ).catch((err) => {
    // Preserve 403s (member lacking role); convert membership-404s to Queue.
    if (err instanceof Error && err.name === "AppError" && (err as { status?: number }).status === 403) throw err;
    throw notFound("Queue");
  });
  return { queue, project };
}
