# MeritRound

MeritRound is a GenLayer Project for rubric-based competitions, community
awards, accelerators, hackathons, design challenges, and open calls.

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
2. The organizer opens the round and finalists register exact HTTPS evidence
   URLs with SHA-256 commitments.
3. The organizer locks the round. The rubric, finalist set, evidence URLs, and
   commitments become the evaluation universe.
4. `resolve_round` independently fetches and authenticates every artifact,
   evaluates the committed evidence, and requires validator agreement on the
   canonical result.
5. A valid winner finalizes the round. A valid inconclusive result stores an
   explicit terminal no-winner outcome.

## Architecture

- `contracts/meritround.py` is the authoritative Intelligent Contract.
- `frontend/` is a typed Vite application with real reads, wallet-gated
  writes, lifecycle progress, and persistent browser transaction recovery.
- `deploy/` contains the deployment helper for finality, execution checks, and
  `contract_info()` readback.
- `tests/direct/` contains Direct Mode contract tests.
- `tests/frontend/` contains transaction, wallet, persistence, recovery, and UI
  model tests.
- `evidence/` contains deterministic demonstration fixtures and the structured
  Studionet proof.
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
- `/app/rounds/:roundId/submit` — finalist registration and evidence commitment;
- `/app/activity` — persisted transaction lifecycle history.

State-changing actions follow one lifecycle:

```text
precondition read -> one broadcast -> persist tx ID -> reconcile same ID
-> finality -> execution check -> LATEST_FINAL readback -> expected-state check
```

Refreshes, polling interruptions, and RPC ambiguity never trigger a blind
rebroadcast after a transaction ID exists. Browser records are scoped to the
configured network, chain ID, and contract address.

## Development proof

### Studionet live-proven

The current development deployment is:

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

### Direct Mode tested

The Direct Mode suite contains 33 tests covering state transitions,
authorization, duplicate IDs, bounded input, evidence availability and
integrity, malformed evidence, prompt-injection boundaries, strict result
validation, terminal immutability, deterministic IDs, model failure, and
validator disagreement. Frontend and UI model tests currently total 17 tests.

### Not yet proven

Bradbury deployment and Bradbury application lifecycle are not yet proven.
The main MeritRound application has not been deployed to Vercel. The Vercel
deployment referenced by the proof is a separate static host for the two exact
demonstration evidence fixtures, not the main application.

## Security and trust model

Evidence is untrusted content. The contract requires HTTPS, bounded URLs and
content, exact SHA-256 equality over fetched bytes, a bounded JSON schema, and
strict semantic result parsing. Evidence is placed in clearly delimited prompt
sections; instructions or fake verdicts inside evidence are content, not
evaluator instructions.

Validators independently fetch and validate the same committed artifacts. A
winner must belong to the locked finalist set. `INCONCLUSIVE` must contain an
empty submission ID. Evidence, model, consensus, and network failures do not
become ordinary business winners.

The evidence boundary is important: MeritRound proves semantic evaluation
against exact committed evidence bytes. It does not independently prove the
real-world truth of claims inside arbitrary contestant evidence unless the
competition's evidence policy separately establishes that truth.

## Limitations

- The current deployment is development-only Studionet evidence.
- Bradbury deployment is intentionally pending release-gate completion.
- The application uses browser wallet identity; it does not provide email
  authentication or centralized accounts.
- V1 does not include tokenomics, payouts, governance, reputation, appeals,
  subscriptions, chat, or an administrator winner override.
- Immutable evidence hosting and source-policy decisions remain part of the
  competition's operational responsibility.
- No external security audit is claimed.

## Developer details

Install dependencies with the lockfile and run the available checks:

```powershell
python -m pip install -r requirements.txt
python -m pytest -q
npm run test:frontend
npm run typecheck:frontend
npm run typecheck:deploy
npm run build
$env:PYTHONUTF8 = '1'
& "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\Scripts\genvm-lint.exe" check contracts/meritround.py --json
```

The current pinned application dependency is `genlayer-js` `1.1.8`. The
installed project tooling baseline is GenLayer CLI `0.39.1`, `genlayer-test`
`0.29.2`, and `genvm-lint` `0.10.0`. The stable direct SDK path is used because
the installed stack does not expose a compatible stable Transaction Kit.

MeritRound is the only product in this repository. No standalone Intelligent
Contract or unrelated contribution belongs here.
