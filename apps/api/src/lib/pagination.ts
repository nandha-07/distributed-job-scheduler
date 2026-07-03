/**
 * Pagination: parse ?limit=&offset= safely. Limit is capped server-side —
 * clients never dictate unbounded result sizes.
 */
import { z } from "zod";
import type { Request } from "express";

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export function getPagination(req: Request): { limit: number; offset: number } {
  const parsed = paginationSchema.safeParse({
    limit: req.query.limit,
    offset: req.query.offset,
  });
  // Nonsense values fall back to defaults rather than erroring a list view.
  return parsed.success ? parsed.data : { limit: 25, offset: 0 };
}

export function paginated<T>(
  rows: T[],
  total: number,
  p: { limit: number; offset: number },
) {
  return { data: rows, pagination: { total, limit: p.limit, offset: p.offset } };
}
