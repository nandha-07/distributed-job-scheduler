/**
 * Structured logging for every process.
 *
 * Why structured (JSON) instead of console.log?
 *  - Machines can filter/aggregate it (grep by jobId, level, service).
 *  - Every line carries context (which service, which job) automatically.
 * pino is the de-facto standard fast JSON logger for Node.
 */
import pino from "pino";
import { config } from "@jobs/config";

export function createLogger(service: string) {
  return pino({
    level: config.LOG_LEVEL,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
