/**
 * JWT authentication middleware.
 * Extracts "Authorization: Bearer <token>", verifies the signature and
 * expiry, and attaches the user id to the request. Any failure → 401.
 * Routes mounted after this middleware can trust req.userId.
 */
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "@jobs/config";
import { unauthorized } from "../lib/errors.js";

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(unauthorized("Missing Authorization: Bearer <token> header"));
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      next(unauthorized("Malformed token"));
      return;
    }
    req.userId = payload.sub;
    next();
  } catch {
    // Covers bad signature AND expiry — same response on purpose:
    // don't help attackers distinguish failure modes.
    next(unauthorized("Invalid or expired token"));
  }
}
