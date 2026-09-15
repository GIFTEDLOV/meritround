# Draft reviewer response — MeritRound V2

## Steward remediation

V2 separates registration from finalist selection. Only the organizer can
select or deselect submissions while the round is open; lock requires two to
sixteen selected submissions, writes a deterministic sorted finalist array,
and stores an evaluation-universe digest over the exact locked IDs, titles,
and committed evidence SHA values. The locked set cannot change afterward, and
unselected registrations are not included in evaluation or winner validation.

V2 adds write-once authenticated evidence snapshots. The committed lowercase
SHA-256 is immutable and is the evidence identity; URLs are only transport and
provenance. Original pinning or exact-byte HTTPS mirror recovery validates the
same SHA and schema. Resolution reads only stored snapshots and performs no
live evidence fetch, so a later URL outage cannot block a locked round once its
evidence has been snapshotted. A missing snapshot fails closed without moving
the round to a result.

## Verification

The audited branch passes 25 V2 direct tests, 21 frontend tests, frontend and
deployment typechecks, production build, GenVM lint, dependency audits, secret
scan, source parity, and 11/11 critical mutation kills. The historical V1
source remains preserved at `contracts/meritround.py`.

## Live status

The Bradbury read-only gate found advancing blocks but a broken fee path:
`quoteGasPrice()` and `messageFeeParamsBudgetFloor()` both reverted. No
Bradbury smoke or V2 deployment was attempted. The permitted stable Studionet
fallback smoke was broadcast once and tracked to `FINALIZED`, but execution
was `ERROR / invalid_contract` for the v0.6-style Hello source. Therefore no
V2 contract address or V2 live steward proof is claimed. Publication remains
intentionally stopped pending a runtime-compatible candidate and a successful
smoke gate.
