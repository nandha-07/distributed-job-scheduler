/**
 * Handler registry: job name → async function.
 *
 * Real deployments register business logic here (send actual emails, etc.).
 * Our demo handlers simulate I/O work and support test controls via payload:
 *   { "sleepMs": 2000 }          → take this long
 *   { "simulateFailure": true }  → throw (exercises failure path & M7 retries)
 */

export interface HandlerContext {
  jobId: string;
  attempt: number;
  /** Writes to job_logs — visible in the dashboard's log viewer. */
  log: (message: string, level?: "debug" | "info" | "warn" | "error") => Promise<void>;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: HandlerContext,
) => Promise<void>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simulatedWork(defaultMs: number): JobHandler {
  return async (payload, ctx) => {
    if (payload["simulateFailure"] === true) {
      await ctx.log("simulated failure requested by payload", "warn");
      throw new Error("Simulated failure (payload.simulateFailure = true)");
    }
    const ms =
      typeof payload["sleepMs"] === "number"
        ? (payload["sleepMs"] as number)
        : defaultMs;
    await ctx.log(`working for ${ms}ms (attempt ${ctx.attempt})`);
    await sleep(ms);
    await ctx.log("done");
  };
}

const registry: Record<string, JobHandler> = {
  "send-email": simulatedWork(800),
  "resize-image": simulatedWork(1_500),
  "send-digest": simulatedWork(500),
  refund: simulatedWork(400),
  "generate-report": simulatedWork(3_000),
};

export function getHandler(name: string): JobHandler | undefined {
  return registry[name];
}
