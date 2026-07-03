/**
 * Cron helpers — pure functions over cron-parser.
 * Used by the API (validate expressions at creation) and the scheduler
 * (compute each next occurrence). One implementation, one behavior.
 */
import cronParser from "cron-parser";

/** Throws with a readable message if the expression is invalid. */
export function assertValidCron(expression: string, timezone = "UTC"): void {
  cronParser.parseExpression(expression, { tz: timezone });
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Next occurrence strictly after `from` (default: now). */
export function nextCronRun(
  expression: string,
  timezone = "UTC",
  from: Date = new Date(),
): Date {
  const it = cronParser.parseExpression(expression, {
    tz: timezone,
    currentDate: from,
  });
  return it.next().toDate();
}
