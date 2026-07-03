/**
 * Gives every request a unique id (echoed as X-Request-Id and attached to
 * logs) and logs one structured line per completed request with duration
 * and status — the backbone of observability. When a user reports "my
 * request failed", the id in their response header finds every related
 * log line.
 */
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { createLogger } from "@jobs/core";

const log = createLogger("api");

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  req.requestId = (req.headers["x-request-id"] as string) ?? randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    log.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: req.userId,
      },
      "request completed",
    );
  });
  next();
}
