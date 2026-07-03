/**
 * Route-parameter helpers. Without this, a malformed id like /queues/abc
 * would reach Postgres and blow up as a 500 ("invalid input syntax for
 * type uuid"). Validating at the edge keeps errors where they belong: 400.
 */
import type { Request } from "express";
import { z } from "zod";
import { badRequest } from "./errors.js";

const uuid = z.string().uuid();

export function uuidParam(req: Request, name: string): string {
  const value = req.params[name];
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw badRequest("INVALID_ID", `Route parameter '${name}' must be a UUID`);
  }
  return parsed.data;
}
