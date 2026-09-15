# MeritRound V2 security invariants

This document is the pre-deployment security contract for `contracts/meritround_v2.py`.

## Finalist-set invariants

- `register_submission` records a submission only; it never selects a finalist.
- Only the round organizer may call `set_finalist` and only while the round is `OPEN`.
- Selection is bounded by `MAX_FINALISTS`; registration is bounded separately by `MAX_SUBMISSIONS`.
- Selection and deselection reject duplicates and use a deterministic sorted order at lock.
- `lock_round` requires `MIN_FINALISTS <= selected_count <= MAX_FINALISTS` and writes the exact locked set once.
- After lock, the selected and locked arrays, rubric, submission identity, and evaluation digest cannot change.
- Evaluation iterates only the locked finalist array. A registered-but-unselected submission is never placed in the evaluation prompt and cannot be returned as a winner.
- The evaluation universe digest binds the round ID, rubric, finalist IDs, titles, and expected evidence SHA-256 values.

## Evidence-liveness invariants

- `expected_sha256` is committed at registration and has no mutation method.
- Evidence identity is the exact committed SHA-256; URLs are transport/provenance only.
- `pin_evidence` and `recover_evidence` are locked-finalist-only operations and accept HTTPS URLs without credentials.
- A fetched body must be non-empty, within the byte bound, hash exactly to the committed SHA, and parse as the exact versioned evidence schema.
- A recovery URL cannot supply or alter the expected SHA, rubric, submission identity, finalist set, or universe digest.
- A snapshot is write-once and binds round ID, finalist ID, and expected SHA.
- `resolve_round` reads and revalidates only stored snapshot bytes. It performs zero live evidence HTTP reads.
- A missing snapshot fails closed and leaves the round `LOCKED`, so a valid recovery can continue the same round.
- Prompt-injection text is inserted into explicitly untrusted evidence delimiters and is never an authoritative result field.

## Consensus invariants

- Evidence hash/schema authentication occurs before semantic adjudication.
- The leader and validator independently derive the same bounded decision witness.
- Consensus compares only canonical `outcome` and `submission_id` fields; prose, formatting, and raw evidence are not authoritative.
- The only terminal semantic result is `WINNER + locked finalist ID` or `INCONCLUSIVE + empty ID`.
- Validator/runtime disagreement is not converted into a business outcome.

## Lifecycle invariants

- Terminal states and terminal results are immutable.
- Every browser write follows precondition read, single broadcast, persisted transaction ID, same-ID reconciliation, finalized status, successful execution, and authoritative readback.
- `ACCEPTED` is an intermediate decision phase, never success by itself.

The local proof for these invariants is 25 direct V2 tests, 21 frontend tests,
and 11 critical mutations killed with no survivors. The repository's V1 direct
suite is retained as historical evidence and is not a V2 gate because it targets
the legacy ABI and intentionally different finalist/evidence semantics.
