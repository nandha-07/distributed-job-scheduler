/**
 * Authorization primitives shared by all resource services.
 *
 * Policy: a user may act on a resource iff they are a member of the
 * organization that (transitively) owns it. When they are not — or the
 * resource does not exist — we answer 404 in BOTH cases, so outsiders
 * cannot probe which ids exist (anti-enumeration; same policy GitHub
 * uses for private repositories).
 */
import { orgsRepo, projectsRepo, queuesRepo } from "@jobs/db";
import type { ProjectRow, QueueRow } from "@jobs/db";
import { notFound } from "../lib/errors.js";

export async function requireProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  const project = await projectsRepo.findById(projectId);
  if (!project) throw notFound("Project");
  const member = await orgsRepo.isMember(userId, project.organization_id);
  if (!member) throw notFound("Project"); // deliberate 404, not 403
  return project;
}

export async function requireQueueAccess(
  userId: string,
  queueId: string,
): Promise<{ queue: QueueRow; project: ProjectRow }> {
  const queue = await queuesRepo.findById(queueId);
  if (!queue) throw notFound("Queue");
  const project = await requireProjectAccess(userId, queue.project_id).catch(
    () => {
      throw notFound("Queue");
    },
  );
  return { queue, project };
}
