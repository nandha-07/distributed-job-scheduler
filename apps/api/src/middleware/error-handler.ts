/**
 * Terminal middleware: every error from any route lands here and leaves
 * as the uniform envelope. Expected errors (AppError) use their status;
 * anything else is a bug → 500, full details logged with the request id,
 * NOTHING internal leaked to the client.
 */
import type { NextFunction, Request, Response } from "express";
import { createLogger } from "@jobs/core";
import { AppError } from "../lib/errors.js";

const log = createLogger("api");

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Express identifies an error handler by its 4-argument signature —
  // `next` must be declared even though we do not call it.
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  log.error(
    { requestId: req.requestId, err },
    "unhandled error — this is a bug",
  );
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Reference id: " + req.requestId,
    },
  });
}
