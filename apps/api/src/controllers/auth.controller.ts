/**
 * Auth controllers: translate HTTP ⇄ service calls. Nothing else.
 * Bodies are already validated+typed by the validate() middleware.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "../services/auth.service.js";

export const registerSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  name: z.string().min(1, "Name is required").max(100).trim(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof registerSchema>;
  const result = await authService.register(body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof loginSchema>;
  const result = await authService.login(body);
  res.json(result);
}

export async function me(req: Request, res: Response): Promise<void> {
  // requireAuth guarantees userId is set on this route.
  const user = await authService.getMe(req.userId as string);
  res.json({ user });
}
