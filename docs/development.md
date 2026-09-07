# MeritRound development integration

This document records the Hour 2 development integration. It is deliberately
not a Bradbury or production deployment claim.

## Network and deployment

- Development network: Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999` (`0xf22f`)
- Contract: `0x2d96cE244D5C6DBBC4FBe37f940eC95f017bAf62`
- Deployment transaction: `0xea2b892e2d6f39c45515d1423a3fb04e5286790cf923dee2b63308eb49ef07d2`
- Deployment status: `FINALIZED`
- Deployment execution: `SUCCESS` from the leader execution result
- Readback: `contract_info()` returned `name: MeritRound`, version `1`, and the expected bounded result schema

The public deployment record is [deployments/studionet.json](../deployments/studionet.json).
No private key is stored in this repository. Localnet was inspected first but
was not running, so the CLI was explicitly switched to Studionet; Bradbury was
not used.

## SDK compatibility decision

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
current SDK write path with zero value; fee profiling remains an explicit
follow-up before production deployment.

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
on Studionet. It does not claim a successful semantic winner resolution. A
future integration fixture must serve exact immutable evidence bytes with
matching SHA-256 commitments before a successful `FINALIZED` resolution can be
claimed.

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
