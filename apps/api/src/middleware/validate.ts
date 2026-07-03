/**
 * validate(schema) — parses & validates req.body with Zod BEFORE the
 * controller runs. On success, req.body is replaced with the parsed
 * (typed, defaulted, trimmed) value. On failure → 400 with per-field
 * details. Controllers can therefore trust their input completely.
 */
import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { badRequest } from "../lib/errors.js";

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        badRequest(
          "VALIDATION_ERROR",
          "Request body failed validation",
          result.error.issues.map((i) => ({
            field: i.path.join(".") || "(body)",
            message: i.message,
          })),
        ),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}
