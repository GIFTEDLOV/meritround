# Studio-dev V2 gate record

## Read-only health

- Network: `GenLayer Studio-dev`
- CLI alias: `studio-dev`
- RPC: `https://studio-dev.genlayer.com/api`
- Chain ID: `61997`
- Explorer: `https://explorer-studio-dev.genlayer.com/`
- ConsensusMain: `0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575`
- ConsensusData: `0x88B0F18613Db92Bf970FfE264E02496e20a74D16`
- Blocks: advanced from `1789336285` to `1789336291` during the read-only
  probe.
- Current fee policy was read successfully. The RC client exposed and returned
  `getCurrentFeePolicy`, `estimateFeesDistribution`, and
  `estimateTransactionFees`.

## Minimal v0.6 smoke

The exact V2 dependency header was used in `contracts/hello_smoke.py`, and the
official high-level `genlayer deploy --contract contracts/hello_smoke.py` route
broadcast once. The returned transaction ID was tracked by the same ID with
`genlayer receipt --wait-until finalized --raw`.

The final receipt was:

- Transaction: `0xb9e048aba6cbc13da2fc502b4935c32e5e369e996fc857a2c40e034b755bf7ed`
- Status: `FINALIZED` (numeric `7`)
- Result: `NO_MAJORITY` (numeric `5`)
- Consensus data: `null`
- Execution result: unavailable/`UNKNOWN`
- Lifecycle: `finalized` / `undetermined`
- Contract address: none
- `hello()` readback: not attempted because no contract was produced
- Replacement or rebroadcast: none

This does not satisfy `FINALIZED + FINISHED_WITH_RETURN`, so
`STUDIO_DEV_EXECUTION_HEALTHY = NO`. The exact machine-readable record is
`deployments/v2/studio-dev-smoke.json`.

## Decision

Per the gate, stop. Do not deploy MeritRound V2, do not run a live steward
round, and do not port V2 to stable Studionet in this run. The frozen V2 source
remains unchanged at SHA-256
`6e21cb5f1361f80f5d09d20087122d271edec6c96d7270d44f6234d3b588272b` and 29,586
bytes.
