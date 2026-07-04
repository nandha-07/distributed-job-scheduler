import { describe, expect, it } from "vitest";
import { computeRetryDelayMs } from "../src/retry.js";

const base = { baseDelayMs: 1000, maxDelayMs: 10_000, jitter: false as const };

describe("computeRetryDelayMs", () => {
  it("fixed: constant delay regardless of attempt", () => {
    expect(computeRetryDelayMs({ ...base, strategy: "fixed", attempt: 1 })).toBe(1000);
    expect(computeRetryDelayMs({ ...base, strategy: "fixed", attempt: 7 })).toBe(1000);
  });

  it("linear: base × attempt", () => {
    expect(computeRetryDelayMs({ ...base, strategy: "linear", attempt: 1 })).toBe(1000);
    expect(computeRetryDelayMs({ ...base, strategy: "linear", attempt: 3 })).toBe(3000);
  });

  it("exponential: base × 2^(attempt-1)", () => {
    expect(computeRetryDelayMs({ ...base, strategy: "exponential", attempt: 1 })).toBe(1000);
    expect(computeRetryDelayMs({ ...base, strategy: "exponential", attempt: 4 })).toBe(8000);
  });

  it("caps at maxDelayMs", () => {
    expect(computeRetryDelayMs({ ...base, strategy: "exponential", attempt: 10 })).toBe(10_000);
    expect(computeRetryDelayMs({ ...base, strategy: "linear", attempt: 99 })).toBe(10_000);
  });

  it("jitter stays within ±25% and never exceeds the cap", () => {
    for (let i = 0; i < 200; i++) {
      const d = computeRetryDelayMs({
        strategy: "fixed", attempt: 1, baseDelayMs: 1000, maxDelayMs: 10_000,
      });
      expect(d).toBeGreaterThanOrEqual(750);
      expect(d).toBeLessThanOrEqual(1250);
    }
    for (let i = 0; i < 50; i++) {
      const d = computeRetryDelayMs({
        strategy: "exponential", attempt: 10, baseDelayMs: 1000, maxDelayMs: 10_000,
      });
      expect(d).toBeLessThanOrEqual(10_000);
    }
  });
});
