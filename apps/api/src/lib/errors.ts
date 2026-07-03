/**
 * Application errors.
 *
 * Services throw AppError with a status + stable machine-readable code;
 * the error-handler middleware turns it into the uniform JSON envelope.
 * Anything that is NOT an AppError is a bug → 500, details logged but
 * never leaked to the client.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// Convenience constructors — read like the HTTP spec.
export const badRequest = (code: string, msg: string, details?: unknown) =>
  new AppError(400, code, msg, details);
export const unauthorized = (msg = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have access to this resource") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") =>
  new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, msg: string) =>
  new AppError(409, code, msg);
