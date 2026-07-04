import { describe, expect, it } from "vitest";
import { canTransition, JOB_STATES, TERMINAL_STATES } from "../src/job-state.js";

describe("job state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("scheduled", "queued")).toBe(true);
    expect(canTransition("queued", "claimed")).toBe(true);
    expect(canTransition("claimed", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
  });

  it("allows failure, retry, and DLQ paths", () => {
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("failed", "scheduled")).toBe(true); // retry backoff
    expect(canTransition("failed", "dead_letter")).toBe(true);
    expect(canTransition("dead_letter", "queued")).toBe(true); // manual retry
  });

  it("allows reaper recovery paths", () => {
    expect(canTransition("claimed", "queued")).toBe(true);
    expect(canTransition("running", "queued")).toBe(true);
  });

  it("forbids nonsense transitions", () => {
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const terminal of TERMINAL_STATES) {
      for (const target of JOB_STATES) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });
});
