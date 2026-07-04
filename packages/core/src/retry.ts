/**
 * Retry backoff math — pure, deterministic modulo jitter, unit-testable.
 * attempt = which attempt just FAILED (1-based).
 */
export interface RetrySpec {
  strategy: "fixed" | "linear" | "exponential";
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** default true — ±25% randomization to prevent thundering herds */
  jitter?: boolean;
}

export function computeRetryDelayMs(spec: RetrySpec): number {
  let delay: number;
  switch (spec.strategy) {
    case "fixed":
      delay = spec.baseDelayMs;
      break;
    case "linear":
      delay = spec.baseDelayMs * spec.attempt;
      break;
    case "exponential":
      delay = spec.baseDelayMs * 2 ** (spec.attempt - 1);
      break;
  }
  delay = Math.min(delay, spec.maxDelayMs);

  if (spec.jitter !== false) {
    // 0.75x–1.25x: spreads simultaneous failures apart in time.
    delay = Math.round(delay * (0.75 + Math.random() * 0.5));
    delay = Math.min(delay, spec.maxDelayMs);
  }
  return Math.max(delay, 0);
}
