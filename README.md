# MeritRound

MeritRound is a GenLayer Intelligent Contract for rubric-based competitions,
awards, accelerators, hackathons, design challenges, and open calls.

## Current production release

The finished V2 reviewer-fix release is deployed on GenLayer Studionet and is
connected to the public frontend:

- Live app: <https://meritround.vercel.app>
- Network: GenLayer Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Contract: `0x815deBdB251FAC07c6eaD1F7BC65D26116ED5ca6`
- Deployment transaction: `0x174f6479531a45d7573c059c3d8a6198d047f5419976c244711ef0c507d3bae7`
- Contract source: `contracts/meritround_v2.py`
- Contract SHA-256: `96f907a7ba7ff6e984daef175a2b1e749b85a71718a8d237d5cc02ad5e0a75af`
- Runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

Stable release family:

- GenLayer CLI `0.39.2`
- `genlayer-js` `1.1.8`
- `genlayer-py` `0.18.0`
- `genlayer-test` `0.29.2`

The structured deployment record is
[`deployments/v2/studionet-deployment.json`](deployments/v2/studionet-deployment.json).
The complete live proof is
[`evidence/studionet-v2/live-reviewer-proof.json`](evidence/studionet-v2/live-reviewer-proof.json).

## Reviewer fix — live Studionet proof

The current flow makes the evaluation universe explicit and immutable:

1. The organizer defines the round and rubric.
2. Submissions are registered and finalists are explicitly selected.
3. The selected finalist universe is locked before judging.
4. Each locked finalist’s evidence is authenticated against its committed
   SHA-256 and stored as a write-once snapshot.
5. `resolve_round` reads only those authenticated snapshots.
6. Resolution performs zero live evidence web fetches.
7. Unselected submissions are outside the locked judging universe and cannot
   influence the result.
8. An unavailable original evidence URL cannot stall resolution after an exact
   authenticated snapshot has been recovered and stored.
9. Validators independently judge the same locked rubric and evidence universe.
10. Only the bounded canonical `{outcome, submission_id}` result can affect
    contract state.

The live proof used a controlled round with these finalized transactions:

- Finalist A selection: `0x3c92ecfbbac282c1cef8acbb171ff0016b749fb6bca2c7477884146268fb2859`
- Finalist B selection: `0x1b856a8656107790c872cab6ac13a80af5852710aa01e749b75ab8b2d3d066f7`
- Finalist lock: `0x8ec97a2d8a24a8eb2172a315e600f9ab18aed685e5a518c3d256ce618d041667`
- Stored evidence A: `0x95adc4b19ac5cea5c12f9079b0c530b1a8465817cf2eb60271fff7ae564774d9`
- Stored evidence B: `0x52a1bbd35deb07454e0273049966a961fd40cbf69161227f9906706c3818b563`
- Unselected/adversarial attempt: `0x0658969590f7ded8d20160bd84dbdcdd9d664b2df9880ca74d8dc22596bca1de`
- Resolution: `0xc2a0ff837ecbc9e075100fde1fb08653fa1118de9449d0332c6b80743b0ae0e8`

Readback verified that finalist selection was explicit, the finalist set was
locked, both evidence snapshots were `READY` with matching SHA-256 values, and
the unselected post-lock attempt failed closed with
`BUSINESS_ILLEGAL_STATE_FINALIST`. The original URL for finalist A was
unavailable; recovery from an immutable exact-byte mirror succeeded. Resolution
returned the validator-backed terminal `INCONCLUSIVE` result and
`get_resolution_web_fetch_count` returned `0`.

## How MeritRound works

```text
DRAFT -> OPEN -> LOCKED -> EVALUATING -> FINALIZED
                                      \-> INCONCLUSIVE
```

The organizer creates a bounded round, opens it, registers submissions, selects
two to sixteen finalists, and locks that exact set. Every locked finalist must
have a stored authenticated evidence snapshot before resolution. Validators
independently evaluate the locked rubric and evidence; only the strict result
schema below is authoritative:

```json
{"outcome":"WINNER","submission_id":"<locked-submission-id>"}
```

or:

```json
{"outcome":"INCONCLUSIVE","submission_id":""}
```

Evidence is untrusted content. Instructions, fake verdicts, JSON, or prompts
inside evidence remain data and are delimited from evaluator instructions.
Resolution does not refetch evidence; it validates the stored authenticated
bytes and performs the GenLayer validator judgment over that fixed universe.

## Architecture and paths

- `contracts/meritround_v2.py` is the active production contract.
- `contracts/meritround.py` is preserved historical V1 source only.
- `frontend/` is the typed Vite application with real contract reads,
  wallet-gated writes, lifecycle tracking, and transaction recovery.
- `deploy/` contains the stable deployment helper and readback checks.
- `tests/direct/` contains the direct contract suite.
- `tests/frontend/` contains frontend transaction and UI model tests.
- `deployments/v2/` and `evidence/studionet-v2/` contain current structured
  deployment and reviewer-proof records.

## Verified quality status

- Contract tests: **25/25 PASS**
- Direct suite: **58/58 PASS**
- Reviewer regression tests: **5/5 PASS**
- Adversarial/mutation tests: **11/11 killed**
- Frontend tests: **24/24 PASS**
- GenVM lint: **PASS**
- Typecheck: **PASS**
- Production build: **PASS**

## Use

Copy `.env.example` to `.env`, verify the public contract address, then run:

```powershell
npm install
npm run dev
```

The application provides the product overview, contract-backed round browser,
rubric-first round creation, submission registration, finalist/evidence views,
result surfaces, and persistent transaction activity.

Every state-changing action follows:

```text
precondition read -> one broadcast -> persist tx ID -> reconcile same ID
-> finality -> execution check -> expected-state readback
```

Once a transaction ID exists, refreshes, polling interruptions, and RPC
ambiguity never trigger a blind rebroadcast.

## Historical evidence

Bradbury and the earlier Studionet deployment are historical provenance only;
neither is the current production deployment. The historical records remain
preserved in `evidence/bradbury/`, `evidence/studionet/`, `deployments/`, and
`docs/v2-final/`. In particular, the old Bradbury contract and the failed
Studio Next/preview attempts are not the active V2 contract and do not replace
the verified Studionet address above.

## Limitations

- The application uses browser wallet identity; it does not provide email
  authentication or centralized accounts.
- V2 does not include tokenomics, payouts, governance, reputation, appeals,
  subscriptions, chat, or an administrator winner override.
- Immutable evidence hosting and source-policy decisions remain part of the
  competition’s operational responsibility.
- No external security audit is claimed.

## Developer details

```powershell
python -m pip install -r requirements.txt
$env:GENVM_VERSION = 'v0.3.0-rc7'
python -m pytest tests/direct
npm run test:frontend
npm run typecheck:frontend
npm run typecheck:deploy
npm run build
genvm-lint check contracts/meritround_v2.py
```

MeritRound is the only product in this repository. No standalone Intelligent
Contract or unrelated contribution belongs here.
