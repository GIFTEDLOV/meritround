# MeritRound development integration — HISTORICAL DEVELOPMENT RECORD

> This document records earlier development integrations and release-freeze
> decisions. It is not the current production status. For the current release,
> see [README.md](../README.md),
> [deployments/bradbury.json](../deployments/bradbury.json),
> [evidence/bradbury/bradbury-proof.json](../evidence/bradbury/bradbury-proof.json),
> and the current deployment record at
> [`deployments/v2/studionet-deployment.json`](../deployments/v2/studionet-deployment.json).
> The current production app is <https://meritround.vercel.app> on Studionet;
> the historical integrations below are not current production.

This document records the Hour 2 development integration as it existed at that
time. It is deliberately not a statement of the current Bradbury production
deployment.

## Historical network and deployment

- Development network: Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999` (`0xf22f`)
- Historical contract: `0x2d96cE244D5C6DBBC4FBe37f940eC95f017bAf62`
- Deployment transaction: `0xea2b892e2d6f39c45515d1423a3fb04e5286790cf923dee2b63308eb49ef07d2`
- Deployment status: `FINALIZED`
- Deployment execution: `SUCCESS` from the leader execution result
- Readback: `contract_info()` returned `name: MeritRound`, version `1`, and the expected bounded result schema

The public deployment record is [deployments/studionet.json](../deployments/studionet.json).
No private key is stored in this repository. Localnet was inspected first but
was not running, so the CLI was explicitly switched to Studionet; Bradbury was
not used.

## Historical SDK compatibility decision

The repository is pinned to `genlayer-js` `1.1.8`, the compatible installed
stable SDK. The installed SDK exposes `waitForTransactionReceipt` and
`TransactionStatus.FINALIZED`, and its actual receipt payload uses some
snake_case fields. The client normalizes both the installed response shape and
the documented camelCase shape, and derives execution success from the leader
receipt when a top-level execution field is absent.

The current installed SDK does not expose the newer lifecycle helpers or a
transaction-kit package. The official Transaction Kit documentation currently
points to prerelease GitHub references, so Hour 2 uses the stable direct SDK
instead of forcing an unpinned compatibility change. The direct implementation
preserves the same guarantees: one broadcast, immediate tx-ID persistence,
same-ID recovery, finality wait, execution inspection, and expected-state
readback.

## Transaction lifecycle and recovery

Every state-changing action follows:

```text
precondition read -> prepare -> wallet approval -> one broadcast
  -> persist tx ID -> reconcile same ID -> finality -> execution check
  -> LATEST_FINAL readback -> expected-state verification
```

Browser records are stored under `meritround.tx.v1` in localStorage. Records
are scoped to network, chain ID, and contract address. Malformed or foreign
records are ignored. Once a transaction ID exists, refreshes, polling errors,
RPC timeouts, and restarts reconcile that exact ID; they never submit a blind
retry. A transaction is successful only when finality, successful execution,
and the expected contract state all agree.

The UI distinguishes wallet rejection, wrong network, tracking interruption,
execution failure, validator disagreement, and evidence verification failure.
Provisional materialized results are never presented as durable final state.

## Fee policy

The pinned SDK and installed CLI did not expose the newer fee-estimation or
Transaction Kit profiling surface. Hour 2 therefore does not claim a measured
fee profile or add arbitrary magic constants. Development writes use the
SDK write path available at that time with zero value; fee profiling was an
explicit follow-up before production deployment.

## Historical release-freeze Bradbury gate (at that time)

The frozen contract source SHA-256 is
`14bb755eb33ee3a7ae81c41eb0f7a94d371c6d980759b2d6669760021f0d86c7`.
`deploy/deployScript.ts` reads `contracts/meritround.py` directly into a
`Uint8Array`, so the deployable source bytes are byte-identical to that source
hash; no generated deployable artifact is used.

At the time of the release-freeze work, the read-only Bradbury gate was
[`scripts/bradbury_preflight.ps1`](../scripts/bradbury_preflight.ps1). It checks
RPC health, chain identity, deployer address and balance, latest/pending nonce,
pending-transaction risk, the frozen source hash, and fee-estimation
availability. It never signs or broadcasts.

At that time, the stable stack was GenLayer CLI `0.39.1`, `genlayer-js`
`1.1.8`, and `genlayer-test` `0.29.2`. The then-current GenLayer Consensus v0.6 guidance required a
coherent compatible release-candidate family and measured fee distribution for
fee-charging deployments. The installed stable CLI has no `estimate-fees`
command or fee-distribution submission path, so the Bradbury gate remains
blocked at that historical stage until a compatible stack was deliberately
selected and verified. The later verified production deployment is recorded in
the current Bradbury proof linked above.

## Development lifecycle evidence

A real Studionet lifecycle was attempted against the deployed contract:

1. `create_round` finalized successfully and returned round ID
   `99ca3b4ac973a8d8d534e3fe9f0bbc2d067512de865a232bcf5dc2e75188eda7`.
2. `open_round` finalized successfully.
3. Two `register_submission` writes finalized successfully.
4. `lock_round` finalized successfully and readback showed `LOCKED` with both
   finalist IDs and a non-empty evaluation-universe digest.
5. `resolve_round` was submitted with HTTPS URLs whose committed bytes were not
   available at those URLs. The real receipt reached `UNDETERMINED`; the leader
   rollback payload was `EVIDENCE_AVAILABILITY`.
6. Final readback remained `LOCKED`, with no winner and no result record.

This proves the deterministic lifecycle and the evidence fail-closed boundary
on Studionet. That historical failure remains preserved and was not retried.

## Hour 4 semantic success proof

A separate new round completed the full semantic path using exact UTF-8 JSON
fixtures hosted from the immutable Vercel deployment
`dpl_AvdDSGAhxcrkZiaLm6VzG9oz6VDD`:

- Finalist A: `finalist-a.json`, 2,049 bytes,
  SHA-256 `2cd55943b4b65a8416245607f16c2893e5ac39ddbb036e62297601d254bd6794`
- Finalist B: `finalist-b.json`, 1,261 bytes,
  SHA-256 `201f8c0954720a6b11bf316f4fe453d1f1b4d6543c30323453a86190db0012bb`
- Round: `5c70604986b1ed94117d6abeb4a40a124ee2a191663eda6412f05013f737a382`
- Finalist A submission: `6d5c7134691db21489a2c35b49b6a872900352b1b3cdaf2eeabf4bcfca7a2dd7`
- Finalist B submission: `9531ccb20acd6d35cd4a37a076268070c16590af4558cfb8a06cda1cce10cce0`

The public URLs returned HTTP 200 with exact local-byte parity across three
repeated fetches. `create_round`, `open_round`, both registrations,
`lock_round`, and `resolve_round` each reached `FINALIZED` with successful
execution. The resolve receipt reached `MAJORITY_AGREE` and its canonical
decision was `WINNER` for finalist A. `LATEST_FINAL` readback returned the same
winner and `get_round` returned `FINALIZED` with both locked finalists.

The structured proof is recorded in
[evidence/studionet/hour4-proof.json](../evidence/studionet/hour4-proof.json).
This is Studionet development evidence only; it is not Bradbury proof.

## Frontend verification

The Vite app implements `/`, `/app`, `/app/rounds`, `/app/rounds/new`,
`/app/rounds/:roundId`, `/app/rounds/:roundId/submit`, and `/app/activity`.
HTTP smoke checks returned 200 for each route while the dev server was running.
Automated browser/screenshot tooling was unavailable in this environment, so
the visual browser pass remains outstanding.

## Product experience checkpoint

The application shell now uses one restrained dark graphite theme with warm
gold decision accents, semantic state colors, compact navigation, responsive
round cards, a rubric-first create flow, finalist evidence cards, evaluation
confirmation, winner/inconclusive result surfaces, and a persistent activity
indicator. The primary UI breakpoints are 960px, 760px, and 480px; focus-visible
states and reduced-motion handling are included.

Vite now separates the application from heavy static dependencies. The prior
569.47 KB application chunk became approximately 57.87 KB, with a 448.67 KB
GenLayer runtime chunk and an 85.95 KB vendor chunk. This is a loading split,
not a removal of the required GenLayer client.
