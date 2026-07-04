/**
 * Schedules (recurring cron jobs) business logic.
 */
import { schedulesRepo } from "@jobs/db";
import type { ScheduleRow } from "@jobs/db";
import { assertValidCron, isValidTimezone, nextCronRun } from "@jobs/core";
import { badRequest, notFound } from "../lib/errors.js";
import { requireQueueAccess } from "./access.service.js";

export async function createSchedule(
  userId: string,
  queueId: string,
  input: {
    name: string;
    cronExpression: string;
    timezone?: string;
    jobName: string;
    payload?: unknown;
  },
): Promise<ScheduleRow> {
  await requireQueueAccess(userId, queueId, "admin");

  const timezone = input.timezone ?? "UTC";
  if (!isValidTimezone(timezone)) {
    throw badRequest("INVALID_TIMEZONE", `Unknown timezone '${timezone}'`);
  }
  try {
    assertValidCron(input.cronExpression, timezone);
  } catch (err) {
    throw badRequest(
      "INVALID_CRON",
      `Invalid cron expression: ${err instanceof Error ? err.message : "parse error"}`,
    );
  }

  return schedulesRepo.create({
    queueId,
    name: input.name,
    cronExpression: input.cronExpression,
    timezone,
    jobName: input.jobName,
    payload: input.payload,
    // Precomputed so the scheduler's tick is a cheap indexed comparison.
    nextRunAt: nextCronRun(input.cronExpression, timezone),
  });
}

export async function listSchedules(
  userId: string,
  queueId: string,
): Promise<ScheduleRow[]> {
  await requireQueueAccess(userId, queueId);
  return schedulesRepo.listByQueue(queueId);
}

export async function setScheduleActive(
  userId: string,
  scheduleId: string,
  isActive: boolean,
): Promise<ScheduleRow> {
  const schedule = await schedulesRepo.findById(scheduleId);
  if (!schedule) throw notFound("Schedule");
  await requireQueueAccess(userId, schedule.queue_id).catch(() => {
    throw notFound("Schedule");
  });
  await requireQueueAccess(userId, schedule.queue_id, "admin").catch(() => {
    throw notFound("Schedule");
  });
  const updated = await schedulesRepo.setActive(scheduleId, isActive);
  if (!updated) throw notFound("Schedule");
  return updated;
}

export async function deleteSchedule(
  userId: string,
  scheduleId: string,
): Promise<void> {
  const schedule = await schedulesRepo.findById(scheduleId);
  if (!schedule) throw notFound("Schedule");
  await requireQueueAccess(userId, schedule.queue_id).catch(() => {
    throw notFound("Schedule");
  });
  await schedulesRepo.remove(scheduleId);
}
