import { describe, expect, it } from "vitest";
import {
  activityStatus,
  activityStepIndex,
  roundStateMeta,
  stateLabel,
  transactionPhaseMeta,
} from "../../frontend/src/uiModel";

describe("MeritRound UI state model", () => {
  it("keeps all contract states human-readable", () => {
    expect(Object.keys(roundStateMeta)).toEqual([
      "DRAFT",
      "OPEN",
      "LOCKED",
      "EVALUATING",
      "FINALIZED",
      "INCONCLUSIVE",
    ]);
    expect(stateLabel("INCONCLUSIVE")).toBe("Inconclusive");
    expect(roundStateMeta.LOCKED.title).toBe("Finalists locked");
  });

  it("maps transaction phases to user-facing progress", () => {
    expect(transactionPhaseMeta.QUEUED.label).toBe("Validators processing");
    expect(transactionPhaseMeta.WAITING_FOR_FINALITY.short).toBe("Finalizing");
    expect(activityStepIndex("RESOLVED")).toBe(4);
    expect(activityStepIndex("TRACKING_INTERRUPTED")).toBe(2);
  });

  it("distinguishes completed, failed, and recoverable actions", () => {
    expect(activityStatus({ phase: "RESOLVED", terminal: true })).toBe("Completed");
    expect(activityStatus({ phase: "FAILED", terminal: true })).toBe("Failed");
    expect(activityStatus({ phase: "TRACKING_INTERRUPTED", terminal: false })).toBe("Recoverable");
    expect(activityStatus({ phase: "QUEUED", terminal: false })).toBe("Processing");
  });
});
