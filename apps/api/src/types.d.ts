/**
 * Type-level extension of Express's Request via declaration merging:
 * middleware attaches these fields; TypeScript needs to know they exist.
 */
declare global {
  namespace Express {
    interface Request {
      /** Set by request-context middleware on every request. */
      requestId: string;
      /** Set by auth middleware after JWT verification. */
      userId?: string;
    }
  }
}

export {};
