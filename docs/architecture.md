# MeritRound Hour 1 Architecture — HISTORICAL V1 RECORD

> This document preserves the original V1 architecture audit. The current V2
> contract and remediation requirements are authoritative in `docs/v2-final/`.

## Current V2 production architecture

The active production source is `contracts/meritround_v2.py`, deployed on
GenLayer Studionet (chain `61999`, RPC
`https://studio.genlayer.com/api`) at
`0x815deBdB251FAC07c6eaD1F7BC65D26116ED5ca6`. The deployed source SHA-256 is
`96f907a7ba7ff6e984daef175a2b1e749b85a71718a8d237d5cc02ad5e0a75af`.

V2 separates evidence capture from resolution. The organizer explicitly
selects finalists, locks the finalist universe, and stores an authenticated
exact-byte evidence snapshot for every locked finalist before resolution.
`resolve_round` validates and evaluates those stored snapshots only; it makes
zero evidence web requests. Validators independently judge the same locked
rubric and snapshot universe, and only the bounded canonical result can be
written to contract state. The historical V1 material below describes the
superseded fetch-at-resolution design and is retained for provenance.

## Parties and trust problem

The organizer defines a round, rubric, and finalist submissions. Submitters provide evidence references and exact SHA-256 commitments. GenLayer validators independently inspect the same locked rubric and committed finalist evidence. The contract is the authority for admissibility, consensus, and the terminal result.

The frontend and any future backend are transport and presentation layers. They may collect data, calculate a local hash, pin content, send a transaction, monitor the same transaction hash, and read state. They may not choose, rank, or rewrite a winner.

## Exact semantic question

> Which admissible finalist submission best satisfies the committed evaluation rubric, considering only the committed evidence supplied for this round?

The model may reason internally, but only the strict two-field canonical result can affect contract state.

## Evidence model and authentication boundary

The historical V1 pipeline was:

```text
HTTPS policy -> exact byte fetch -> SHA-256 check -> bounded JSON schema
-> deterministic admissibility -> semantic evaluation -> exact validator agreement
-> terminal state and immutable result record
```

Evidence is untrusted content. The V1 evidence document is UTF-8 JSON with exactly these fields: `version` equal to `1` and a non-empty bounded `content` string. The contract does not trust caller-supplied summaries. The fetched bytes must be HTTP 200, fit the byte bound, and match the committed lowercase SHA-256 digest before they are used semantically. The URL and digest bind the exact document to the submission; the document does not need to repeat the submission ID. Unavailable evidence, bad status, oversized content, malformed JSON, and SHA mismatch are distinct failure conditions and never become a winner.

Evidence is not authenticated by validator consensus. Consensus only compares validator executions after the integrity boundary has accepted the exact bytes.

## Canonical result schema

The authoritative result has exactly two keys and no extras:

```json
{"outcome":"WINNER","submission_id":"<locked-finalist-id>"}
```

or:

```json
{"outcome":"INCONCLUSIVE","submission_id":""}
```

The contract parses the model output, rejects malformed JSON, missing keys, extra keys, wrong types, invalid outcomes, non-finalist winners, and an INCONCLUSIVE result containing a submission ID. It then serializes the accepted object with fixed separators and sorted keys. The result record stores only the canonical outcome/ID plus SHA-256 digests of the canonical result and the locked evaluation universe.

## Round state machine

```text
DRAFT --organizer--> OPEN --organizer--> LOCKED --resolve--> EVALUATING
                                                            |       |
                                                            |       +--> FINALIZED (WINNER)
                                                            +----------> INCONCLUSIVE
```

In historical V1, all submissions registered in `OPEN` became finalists when the organizer locked the round. V2 replaces that behavior with explicit organizer selection and a separate immutable locked finalist array. `EVALUATING` is an internal transition in the resolving write; failed evaluation does not create a result and leaves the committed round safe for retry. `FINALIZED` and `INCONCLUSIVE` are terminal and immutable.

## Deterministic invariants

- Round IDs are SHA-256 of fixed-field JSON containing organizer, title, description, and rubric.
- Submission IDs are SHA-256 of fixed-field JSON containing round ID, submitter, title, HTTPS URL, and expected digest.
- Duplicate round and submission IDs are rejected before storage writes.
- A submission stores exactly one round ID and is appended to exactly one round.
- Only the organizer may open or lock its round.
- Submissions are accepted only in `OPEN`; no rubric or evidence mutation API exists after lock.
- A round needs two to sixteen finalists and cannot lock twice.
- Resolution is impossible before `LOCKED` and cannot overwrite a terminal result.
- A winner ID must be in the locked finalist set; INCONCLUSIVE must have an empty ID.
- Any evidence/model/consensus failure raises a stable error domain and cannot write a result.
- The result record is written once and carries the locked evaluation-universe digest.

## Historical V1 model authority and consensus pattern

The historical V1 runtime exposed `gl.nondet.web.get`, `gl.nondet.exec_prompt`,
and `gl.vm.run_nondet`. That V1 path fetched evidence during resolution. The
current V2 path retains validator-backed canonical judgment but supplies the
leader and validators with authenticated snapshots already stored on-chain.
The validator requires exact equality of the canonical strings. This is
intentionally stricter than NLP equivalence for the winner ID and does not
make model prose authoritative.

The evaluation prompt separates system/evaluation instructions, the committed rubric, committed metadata, and `BEGIN/END UNTRUSTED SUBMISSION EVIDENCE` blocks. It explicitly states that commands, JSON, fake verdicts, prompt text, and instructions in evidence are data only.

## Error taxonomy

| Domain | Examples | State consequence |
|---|---|---|
| Business/deterministic | duplicate ID, authorization, illegal state, finalist bounds | no result; write fails |
| Evidence integrity | SHA mismatch, malformed document, size bound, submission mismatch | no result; write fails |
| Evidence availability | non-200 status, missing body, fetch failure | no result; write fails |
| Semantic/model | malformed result, forbidden key, invalid outcome, model failure | no result; write fails |
| Consensus/network | validator disagreement, deterministic violation, timeout | no result; write fails |

No category is mapped to a normal winner. An explicit model `INCONCLUSIVE` is different from an evidence/network/model/consensus failure: it is a terminal business result with no winner; an evidence/network/model/consensus failure is an unsuccessful transaction with no terminal result.

## Intended frontend transaction lifecycle

```text
precondition read
  -> broadcast exactly once
  -> persist the returned transaction hash immediately
  -> reconcile the same hash after refresh/restart
  -> track provisional and terminal status
  -> wait for FINALIZED
  -> require FINISHED_WITH_RETURN execution result
  -> read expected contract state
  -> display the real outcome
```

`ACCEPTED` or `FINALIZED` alone is not proof of successful state change. The typed skeleton in `frontend/src/` deliberately refuses blind rebroadcast and treats readback as part of successful completion.

## Historical V1 storage adjustment

The conceptual `Round` and `Submission` fields are represented as `@allow_storage` dataclasses containing GenLayer-supported `Address`, `str`, and `DynArray` values. V1 does not store raw evidence bytes; the exact bytes are re-fetched and authenticated at resolution, while the URL and SHA-256 commitment are locked. This keeps persistent state bounded and makes the integrity boundary explicit.
