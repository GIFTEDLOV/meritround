# MeritRound V2 forensic audit

Audit scope: the clean public baseline `3d5244960b858fcc052e9054992a3c341418646b`, audited on branch `v2-steward-liveness` before any network write.

## Preservation record

- `STARTING_HEAD`: `3d5244960b858fcc052e9054992a3c341418646b`
- `ORIGIN_MAIN_HEAD`: `3d5244960b858fcc052e9054992a3c341418646b`
- `CURRENT_BRANCH`: `release/bradbury-v05` before branch creation
- `WORKTREE_STATUS`: clean before branch creation
- `UNTRACKED_FILES`: none before branch creation
- `AUDIT_BRANCH`: `v2-steward-liveness`, created from `origin/main`
- No reset, rebase, force-push, or discard was performed.

## Executive result

`FULL_AUDIT = FAIL` for the V1 candidate. The historical V1 contract remains preserved at `contracts/meritround.py`. V2 must be a new source file with a separate source identity, separate tests, and separate deployment manifest.

## Findings

| ISSUE | SEVERITY | FILE | CURRENT BEHAVIOR | RISK | FIX | TEST | LIVE PROOF REQUIREMENT |
|---|---|---|---|---|---|---|---|
| V1 contract is the only deployable source | CRITICAL | `deploy/deployScript.ts` | Reads `contracts/meritround.py` by default | A V2 release can silently deploy the historical contract | Hard-code `contracts/meritround_v2.py`; verify frozen SHA and byte count immediately before broadcast | Deployment source-parity test and manifest check | Deployment receipt and `contract_info().version == 2` |
| Every registration becomes a finalist | CRITICAL | `contracts/meritround.py` | `lock_round` copies all registered IDs into the finalist array | Organizer cannot control the evaluation universe; unselected work can influence judging or win | Add explicit organizer-only `set_finalist`; copy only selected IDs at lock | V2 finalist-control adversarial matrix | Register A/B/C, select only A/B, prove C is absent from locked universe and cannot win |
| Evidence is fetched during resolution | CRITICAL | `contracts/meritround.py` | `resolve_round` calls `gl.nondet.web.get` for each finalist | URL outage after a valid prior check can permanently stall the round; resolution is network-sensitive | Add authenticated snapshot writes (`pin_evidence`/`recover_evidence`); resolve from stored bytes only | Snapshot, outage, wrong-mirror, and zero-fetch tests | Original B URL remains unavailable while the same locked round resolves |
| URL participates in submission identity and universe digest | HIGH | `contracts/meritround.py` | Submission ID and universe material include `evidence_url` | Transport/provenance changes are confused with evidence identity | V2 identity binds submission metadata and expected SHA; URL is provenance only | ID and digest stability tests | Recovery URL changes no locked digest or submission ID |
| No persisted evidence status or snapshot view | HIGH | `contracts/meritround.py`, `frontend/src/meritroundClient.ts` | Only URL/SHA are readable | UI cannot distinguish authenticated evidence from merely committed evidence | Add evidence status and snapshot views; expose `READY` only after exact-byte validation | Contract view tests and frontend rendering tests | Every locked finalist reports `READY` before resolve |
| Resolve is not gated by authenticated snapshots | HIGH | `contracts/meritround.py` | Resolution begins with live fetches and does not require prior pinning | A liveness recovery path cannot be enforced safely | Require one stored snapshot per locked finalist | Missing-snapshot fail-closed test | Resolve cannot be submitted before A and B are ready |
| Frontend treats all submissions as finalists | HIGH | `frontend/src/main.ts` | Detail cards label non-finalist records as generic submissions and lock action uses submission count | UI can mislead organizers and enable the wrong lock path | Render REGISTERED/SELECTED/LOCKED FINALIST from contract readback; gate lock on selected count | V2 UI model tests | Live detail page visibly excludes C from locked set |
| Frontend has no pin/recovery workflow | HIGH | `frontend/src/main.ts` | Registration points directly to later live fetch | User cannot recover an unavailable original URL | Add pin and recovery actions, recovery URL form, status display, and resolve gating | Frontend evidence-status/lifecycle tests | Wrong mirror rejected; valid mirror enables resolve |
| Bradbury is mislabeled as Localnet in the UI | HIGH | `frontend/src/main.ts` | `networkLabel()` returns Studionet or Localnet only | Operators may sign on or diagnose the wrong network | Add explicit Bradbury label and network metadata | Frontend config/UI test | Network chip and footer show Bradbury / chain 4221 |
| Invalid network silently falls back to Studionet | HIGH | `frontend/src/meritroundClient.ts` | Any value other than localnet/bradbury maps to Studionet | Typo or stale environment can direct writes to another network | Accept only explicit known aliases; reject invalid configuration | Config rejection test | Release config must identify exactly one selected network |
| Transaction lifecycle accepts `ACCEPTED` as decision available | MEDIUM | `frontend/src/meritroundClient.ts` | `ACCEPTED` maps to `DECISION_AVAILABLE` | Provisional consensus can be presented as final if callers use the phase incorrectly | Keep provisional phase distinct; success only after FINALIZED + successful execution + readback | Lifecycle tests for ACCEPTED and FINALIZED execution failure | Live proof records only finalized successful state |
| Deployment helper has no fee-profile or current-policy gate | HIGH | `deploy/deployScript.ts`, `scripts/bradbury_preflight.ps1` | Historical helper submits without current fee estimation | v0.6 fee charging can reject or underfund deployment; magic historical assumptions may be reused | Select current compatible CLI/SDK; read live fee policy and estimator before any deployment | Tooling/preflight tests | Record estimator output or exact Bradbury blocker; no fabricated fee values |
| Raw outer EVM deployment/write paths are present | CRITICAL | `scripts/bradbury_direct_outer.py`, `tools/request.py`, `tools/transactions.py` | Hand-signed RLP, manual nonce, zero gas price, raw send, and custom polling exist | Duplicate/replacement/rebroadcast and nonce contamination risk; bypasses official fee route | Retain only as historical evidence; mark forbidden for V2; use high-level CLI/SDK once | Static forbidden-path/source audit | No V2 deployment or smoke write may use these helpers |
| Historical evidence claims are mixed with release artifacts | MEDIUM | `evidence/bradbury/*`, `evidence/studionet/*`, `README.md`, `docs/development.md` | Old V1/Studionet/Bradbury records remain adjacent to current claims | Reviewers may mistake V1 proof for V2 proof | Label all historical artifacts; add V2-only manifest and live proof paths | Evidence schema and stale-reference audit | V2 manifest/proof names the exact V2 source and network |
| Requirements and installed tools drift | HIGH | `requirements.txt`, `package.json`, global CLI | Requirements request `genlayer-test 0.29.2`; installed is `0.30.0rc2`; CLI is `0.40.0-rc.3`; repo SDK is `1.1.8` | Direct tests and deployment semantics can diverge from the documented stack | Record exact versions; use the currently compatible family deliberately; do not claim unrun gates | Version report and full matrix | Live deployment evidence records CLI/SDK/tool versions |
| Direct mutation runner targets V1 and stale helper names | HIGH | `scripts/mutation_runner.py` | Mutates `contracts/meritround.py` and references `_validate_model_result` | V2 critical controls can be untested while historical mutations appear healthy | Create V2 mutation suite/runner with current function names and all critical mutations | V2 mutation run must report zero survivors/errors | Release report includes each critical mutation kill |
| `SUCCESS`/leader receipt handling is historical-shape dependent | MEDIUM | `deploy/deployScript.ts`, `frontend/src/meritroundClient.ts`, `tools/structure.py` | Multiple snake/camel and leader-only fields are accepted ad hoc | A receipt can be called successful without authoritative execution validation | Normalize explicit status, execution result, and readback; keep error domains separate | Receipt normalization tests | Proof includes FINALIZED and FINISHED_WITH_RETURN (or documented compatible result) |
| Evidence HTTP policy does not control redirects | MEDIUM | `contracts/meritround.py` | Only submitted URL scheme/credentials are checked; redirect target is not surfaced | Redirect can change transport provenance, although SHA still protects bytes | Treat URL strictly as transport/provenance; never use URL for identity; document redirect limitation | URL adversarial tests plus exact-byte checks | Recovery is accepted only by exact SHA, regardless of redirect/provenance |
| No V2 source, SHA, or byte-count freeze exists | CRITICAL | `deployments/` | Only V1 deployment manifests are present | Source can change between audit and broadcast unnoticed | Freeze V2 source and write `SOURCE_MANIFEST.json`, `FROZEN_SHA256SUMS.txt`, and freeze record | Freeze/parity checks | Recompute immediately before one deploy and require exact equality |

## Phase-gate status after remediation work

- Repository preservation: PASS; the audited branch starts from origin/main at the requested baseline and historical V1 source is preserved.
- V1 preservation: PASS; `contracts/meritround.py` is untouched historical source.
- V2 architecture: IMPLEMENTED; explicit finalist selection and immutable locked-universe binding are present.
- Reviewer remediation: IMPLEMENTED; the local adversarial and mutation gates are the release prerequisites.
- Contract/security: PASS locally pending final matrix rerun and source freeze; V1 remains historical and intentionally fails the V2 invariants.
- Frontend/lifecycle: PASS locally pending final matrix rerun; the client has V2 selection/evidence states and same-ID reconciliation.
- Tooling/deployment: PASS locally pending final matrix rerun; V2 source is hard-coded and SHA-gated, while raw helpers remain historical and forbidden.
- Read-only V2 preflight: available at `scripts/v2_network_preflight.ps1`; it requires an explicit network and never broadcasts.
- Bradbury network gate: BLOCKED; chain and blocks were healthy, but both current FeeManager quote calls reverted.
- Studionet fallback: BLOCKED after one official Hello smoke finalized with `ERROR` / `invalid_contract`; the same transaction was tracked and never rebroadcast.
- Network writes: V2 contract deployment and steward proof NOT STARTED because the smoke gate did not pass.

## Final disposition

The V2 architecture, steward remediation, contract controls, frontend lifecycle,
source freeze, and local gates pass on the audited branch. Release readiness is
blocked by live compatibility: Bradbury fee infrastructure is unhealthy, and
the stable Studionet runtime rejected the v0.6-style Hello smoke as an invalid
contract. No V2 contract address, V2 deployment transaction, or live V2 round
exists from this audit.
