import { describe, expect, it } from "vitest";
import { assertValidCron, isValidTimezone, nextCronRun } from "../src/cron.js";

describe("cron helpers", () => {
  it("computes the next occurrence after a reference time", () => {
    // From Sat 2026-07-04 00:00 UTC, next "Mondays 09:00" is Mon 2026-07-06.
    const next = nextCronRun("0 9 * * 1", "UTC", new Date("2026-07-04T00:00:00Z"));
    expect(next.toISOString()).toBe("2026-07-06T09:00:00.000Z");
  });

  it("every-5-minutes advances to the next boundary", () => {
    const next = nextCronRun("*/5 * * * *", "UTC", new Date("2026-07-04T10:02:10Z"));
    expect(next.toISOString()).toBe("2026-07-04T10:05:00.000Z");
  });

  it("rejects invalid cron expressions", () => {
    expect(() => assertValidCron("99 * * * *")).toThrow();
    expect(() => assertValidCron("not a cron")).toThrow();
    expect(() => assertValidCron("*/5 * * * *")).not.toThrow();
  });

  it("validates timezones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
  });
});
