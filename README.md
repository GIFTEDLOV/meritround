# MeritRound

MeritRound is a GenLayer Project for rubric-based competitions, community
awards, accelerators, hackathons, design challenges, and open calls.

## Release status

The public Bradbury deployment is historical V1. It remains preserved at
`contracts/meritround.py` and is not the V2 release candidate. The audited V2
candidate is `contracts/meritround_v2.py` on branch `v2-steward-liveness`.

V2 has not been published to GitHub or deployed to Vercel. Its target is Studio
Dev at chain `61997` and `https://studio-dev.genlayer.com/api`. The failed Studio
Dev deployment attempt is preserved in
`deployments/v2/studio-dev-deployment.pending.json`; it was rejected before a
GenLayer transaction because the deployment fee options were omitted. See
`docs/v2-final/` for the audit, invariants, test matrix, and freeze record.

Historical V1 proof: [evidence/bradbury/bradbury-proof.json](evidence/bradbury/bradbury-proof.json).

## Product

MeritRound lets an organizer define a rubric, collect finalist submissions,
commit exact evidence references, lock the evaluation universe, and request a
validator-backed decision. The Intelligent Contract owns the authoritative
result and terminal round state.

## Problem

In a conventional selection process, participants must trust the organizer,
the hosting backend, one AI provider, or an opaque administrator to choose the
winner. MeritRound reduces that trust requirement by making the rubric,
finalists, and evidence commitments explicit before evaluation.

## Why GenLayer

GenLayer validators independently inspect the same locked rubric and committed
evidence. They independently produce a strictly validated canonical decision;
only the equivalent two-field result can affect contract state.

Authoritative results are limited to:

```json
{"outcome":"WINNER","submission_id":"<locked-submission-id>"}
```

or:

```json
{"outcome":"INCONCLUSIVE","submission_id":""}
```

Reasoning, scores, rankings, confidence, payouts, addresses, and prose are not
authoritative.

## How MeritRound works

```text
DRAFT -> OPEN -> LOCKED -> EVALUATING -> FINALIZED
                                      \-> INCONCLUSIVE
```

1. The organizer creates a round with a bounded title, description, and rubric.
2. The organizer opens the round; participants register submissions with exact
   HTTPS evidence commitments.
3. The organizer explicitly selects finalists, then locks the exact set.
4. Each locked finalist gets an authenticated snapshot by pinning the original
   URL or recovering an exact-byte HTTPS mirror.
5. `resolve_round` reads only stored snapshots, evaluates the locked universe,
   and requires validator agreement on the canonical result.
6. A valid winner finalizes the round. A valid inconclusive result stores an
   explicit terminal no-winner outcome.

## Architecture

- `contracts/meritround.py` is the preserved historical V1 contract.
- `contracts/meritround_v2.py` is the audited V2 candidate and the only source
  allowed by the V2 deployment helper.
- `frontend/` is a typed Vite application with real reads, wallet-gated
  writes, lifecycle progress, and persistent browser transaction recovery.
- `deploy/` contains the deployment helper for finality, execution checks, and
  `contract_info()` readback.
- `tests/direct/` contains Direct Mode contract tests.
- `tests/frontend/` contains transaction, wallet, persistence, recovery, and UI
  model tests.
- `evidence/` contains historical demonstration fixtures and proof records;
  they are not V2 live proof.
- `docs/architecture.md` describes the trust model and evidence boundary.
- `docs/development.md` records development deployments and lifecycle evidence.

## Use

Copy `.env.example` to `.env`, verify the configured public contract address and
network, then run:

```powershell
npm install
npm run dev
```

The application provides:

- `/` — product explanation and launch CTA;
- `/app` — contract-backed overview;
- `/app/rounds` — real round directory and filters;
- `/app/rounds/new` — rubric-first round creation;
- `/app/rounds/:roundId` — round, finalists, evaluation, and result state;
- `/app/rounds/:roundId/submit` — submission registration and evidence commitment;
- `/app/activity` — persisted transaction lifecycle history.

State-changing actions follow one lifecycle:

```text
precondition read -> one broadcast -> persist tx ID -> reconcile same ID
-> finality -> execution check -> LATEST_FINAL readback -> expected-state check
```

Refreshes, polling interruptions, and RPC ambiguity never trigger a blind
rebroadcast after a transaction ID exists. Browser records are scoped to the
configured network, chain ID, and contract address.

## Historical V1 Bradbury proof

The complete historical V1 round lifecycle was proven on Bradbury for round
`1f52baf10c386c529bf01bec4c2706f30851a55d39f5c98cb7ec0d63318faff7`:

```text
create -> open -> register A -> register B -> lock -> resolve
-> WINNER -> FINALIZED -> SUCCESS -> LATEST_FINAL readback
```

Deployment, `lock_round`, and `resolve_round` each reached `FINALIZED` with
`FINISHED_WITH_RETURN` execution, `AGREE` consensus, and five `AGREE`
validator receipts. The final round state is `FINALIZED`; the canonical result
is `WINNER` for Finalist A, submission
`f15e63db478c6d6bf637fbea929b7d3172a61770938fefa375ed525201af09c9`.
The `LATEST_FINAL` readback matched the stored result. Consensus here is a
decision mechanism over the committed evidence, not a claim that validator
consensus authenticates arbitrary real-world claims.

The complete deployment and lifecycle record is
[evidence/bradbury/bradbury-proof.json](evidence/bradbury/bradbury-proof.json).

### Historical development evidence — Studionet

The following is preserved historical development evidence and is not the
current production deployment:

- Network: Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Contract: `0x2d96cE244D5C6DBBC4FBe37f940eC95f017bAf62`

A complete new-round lifecycle was proven with exact stable HTTPS evidence:

```text
create -> open -> register A -> register B -> lock -> resolve
-> WINNER -> FINALIZED -> SUCCESS -> LATEST_FINAL readback
```

The winner was submission
`6d5c7134691db21489a2c35b49b6a872900352b1b3cdaf2eeabf4bcfca7a2dd7`.
The resolve receipt was `MAJORITY_AGREE`: leader execution `SUCCESS`, `3 AGREE`,
and `2 IDLE after quorum`, with no disagreement. It was not a unanimous 5/5
vote. The finalized round and winner were confirmed by readback.

The complete transaction and evidence record is
[evidence/studionet/hour4-proof.json](evidence/studionet/hour4-proof.json).
The earlier evidence-availability failure remains documented separately and
was not overwritten or retried.

### V2 local quality status

The audited V2 candidate currently has 25/25 direct contract tests passing,
21/21 frontend tests passing, frontend and deployment typechecks passing, a
production build passing, GenVM lint passing, and 11/11 critical mutations
killed. The V1 direct suite is historical and is not a V2 gate: it targets the
legacy ABI and intentionally tests the superseded automatic-finalist and
resolve-time-fetch behavior. The authoritative V2 results are maintained in
`docs/v2-final/TEST_MATRIX.md`.

## Security and trust model

Evidence is untrusted content. The V2 contract requires HTTPS, bounded URLs and
content, exact SHA-256 equality over fetched bytes, a bounded semantic schema,
and strict result parsing. Evidence is placed in clearly delimited prompt
sections; instructions or fake verdicts inside evidence are content, not
evaluator instructions. Resolution performs no live evidence fetches: it uses
only authenticated, write-once snapshots.

Validators independently fetch and validate the same committed artifacts. A
winner must belong to the locked finalist set. `INCONCLUSIVE` must contain an
empty submission ID. Evidence, model, consensus, and network failures do not
become ordinary business winners.

The evidence boundary is important: MeritRound proves semantic evaluation
against exact committed evidence bytes. It does not independently prove the
real-world truth of claims inside arbitrary contestant evidence unless the
competition's evidence policy separately establishes that truth.

## Limitations

- Historical V1 is deployed on Bradbury; V2 publication and live deployment are
  still awaiting authorization.
- The application uses browser wallet identity; it does not provide email
  authentication or centralized accounts.
- V2 does not include tokenomics, payouts, governance, reputation, appeals,
  subscriptions, chat, or an administrator winner override.
- Immutable evidence hosting and source-policy decisions remain part of the
  competition's operational responsibility.
- No external security audit is claimed.

## Developer details

Install dependencies with the lockfile and run the available checks:

```powershell
python -m pip install -r requirements.txt
python -m pytest -q tests/direct/test_meritround_v2.py
python scripts/v2_mutation_runner.py
npm run test:frontend
npm run typecheck:frontend
npm run typecheck:deploy
npm run build
$env:PYTHONUTF8 = '1'
& "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\Scripts\genvm-lint.exe" contracts/meritround_v2.py
```

The application uses `genlayer-js` `2.0.0-rc.1` and
`@genlayer/transaction-kit` `0.1.0-rc.2`. MeritRound is a vanilla Vite/TypeScript
frontend, so the React adapter is not applicable. The repository declares
`genlayer-test` `0.29.2`; the current machine has GenLayer CLI `0.40.0-rc.3`,
`genlayer-test` `0.30.0rc2`, `genlayer-py` `0.19.0rc2`, and `genvm-lint`
`0.11.0`. V2 direct tests are pinned to the cached v0.6 runner and the
deployment source is SHA-checked against the frozen manifest; live deployment
tool compatibility must be recorded by the network gate.

MeritRound is the only product in this repository. No standalone Intelligent
Contract or unrelated contribution belongs here.
