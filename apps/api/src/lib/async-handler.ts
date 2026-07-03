/**
 * Express 4 does not catch errors thrown in async handlers — an unhandled
 * rejection would hang the request. This wrapper forwards any rejection to
 * next(), which routes it to our error-handler middleware.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
