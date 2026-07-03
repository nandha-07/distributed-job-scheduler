/**
 * Auth route wiring: URL → middleware chain → controller.
 * Reading this file top-to-bottom tells you the auth API surface.
 */
import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import * as auth from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post(
  "/auth/register",
  validate(auth.registerSchema),
  asyncHandler(auth.register),
);
authRouter.post(
  "/auth/login",
  validate(auth.loginSchema),
  asyncHandler(auth.login),
);
authRouter.get("/me", requireAuth, asyncHandler(auth.me));
