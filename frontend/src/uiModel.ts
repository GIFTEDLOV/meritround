import type { EvidenceStatus, RoundState, SelectionState, TransactionPhase, TransactionRecord } from "./meritroundClient";

export const roundStateMeta: Record<RoundState, { label: string; title: string; description: string }> = {
  DRAFT: { label: "Draft", title: "Preparing this round", description: "Review the rubric, then open the round when you are ready to accept finalists." },
  OPEN: { label: "Open", title: "Accepting finalists", description: "Submissions can be added while the organizer prepares the final set." },
  LOCKED: { label: "Locked", title: "Finalists locked", description: "The rubric, finalist set, and evidence commitments are frozen for evaluation." },
  EVALUATING: { label: "Evaluating", title: "Validators are reviewing", description: "The evaluation transaction is moving through decision and finality checks." },
  FINALIZED: { label: "Finalized", title: "Decision finalized", description: "The contract has stored a canonical result against the locked evaluation universe." },
  INCONCLUSIVE: { label: "Inconclusive", title: "No winner established", description: "Validators did not establish a canonical winner. No finalist was selected by default." },
};

export const transactionPhaseMeta: Record<TransactionPhase, { label: string; short: string }> = {
  PREPARING: { label: "Preparing", short: "Preparing" },
  WAITING_FOR_WALLET: { label: "Waiting for wallet", short: "Wallet" },
  SUBMITTED: { label: "Submitted", short: "Submitted" },
  QUEUED: { label: "Validators processing", short: "Processing" },
  DECISION_AVAILABLE: { label: "Decision available", short: "Decision" },
  WAITING_FOR_FINALITY: { label: "Waiting for finality", short: "Finalizing" },
  EXECUTION_VERIFIED: { label: "Execution verified", short: "Verified" },
  RESOLVED: { label: "Result confirmed", short: "Completed" },
  FAILED: { label: "Action failed", short: "Failed" },
  TRACKING_INTERRUPTED: { label: "Tracking interrupted", short: "Recoverable" },
};

export function stateLabel(state: string): string {
  return roundStateMeta[state as RoundState]?.label ?? state.replaceAll("_", " ");
}

export const selectionStateMeta: Record<SelectionState, { label: string; description: string }> = {
  REGISTERED: { label: "Registered", description: "Registered submission; not part of the locked evaluation set." },
  SELECTED: { label: "Selected", description: "Organizer-selected candidate; selection remains editable while the round is open." },
  LOCKED_FINALIST: { label: "Locked finalist", description: "Included in the immutable evaluation universe." },
};

export const evidenceStatusMeta: Record<EvidenceStatus, { label: string; description: string }> = {
  NOT_PINNED: { label: "Recovery needed", description: "The exact committed bytes are not yet authenticated on-chain." },
  READY: { label: "Ready", description: "Exact committed bytes are snapshotted and ready for resolution." },
};

export function activityStepIndex(phase: TransactionPhase): number {
  return {
    PREPARING: 0,
    WAITING_FOR_WALLET: 0,
    SUBMITTED: 0,
    QUEUED: 1,
    DECISION_AVAILABLE: 2,
    WAITING_FOR_FINALITY: 3,
    EXECUTION_VERIFIED: 4,
    RESOLVED: 4,
    FAILED: 3,
    TRACKING_INTERRUPTED: 2,
  }[phase];
}

export function activityStatus(record: Pick<TransactionRecord, "phase" | "terminal">): string {
  if (record.phase === "RESOLVED") return "Completed";
  if (record.phase === "FAILED") return "Failed";
  if (record.phase === "TRACKING_INTERRUPTED") return "Recoverable";
  if (record.phase === "WAITING_FOR_FINALITY") return "Finalizing";
  if (record.phase === "DECISION_AVAILABLE") return "Decision available";
  if (record.phase === "QUEUED") return "Processing";
  return record.terminal ? "Completed" : "Pending";
}
