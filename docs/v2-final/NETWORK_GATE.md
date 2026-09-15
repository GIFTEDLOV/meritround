# MeritRound V2 network gate record

## Bradbury

- Read-only CLI network: `testnet-bradbury`
- RPC: `https://rpc-bradbury.genlayer.com`
- Chain ID: `4221`
- ConsensusMain: `0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D`
- ConsensusData: `0x85D7bf947A512Fc640C75327A780c90847267697`
- FeeManager: `0xF205868bf5db79d2162843742D18D0900A9E462a`
- Explorer: `https://explorer-bradbury.genlayer.com/`
- Blocks: advanced from `21649050` to `21649061` during the read-only probe.
- Current CLI: `0.40.0-rc.3`.
- `genlayer estimate-fees --rpc https://rpc-bradbury.genlayer.com --json` failed
  in `estimateTransactionFees` because `quoteGasPrice()` reverted.
- Direct read-only calls to both `quoteGasPrice()` and
  `messageFeeParamsBudgetFloor()` reverted.
- Result: `BRADBURY_INFRA_UNHEALTHY`; no Bradbury smoke or V2 broadcast was
  attempted.

## Studionet fallback

- Read-only CLI network: `studionet`
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- ConsensusMain: `0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575`
- Explorer: `https://genlayer-explorer.vercel.app`
- Blocks: advanced from `1789331603` to `1789331609` during the read-only
  probe.
- Stable candidate checked: GenLayer CLI `0.39.2`, genlayer-js `1.1.8`.
- The stable CLI exposes `estimate-fees` but its client does not expose
  `estimateTransactionFees`; the current 0.40 CLI's Studio fee call
  `sim_getFeeConfig` is not available on this endpoint.

### Smoke result

The official high-level stable CLI route broadcast exactly once. The same
transaction was tracked to `FINALIZED`, but execution was `ERROR` with
`invalid_contract`; the contract was not available for `hello()` readback.
The transaction and source details are recorded in
`deployments/v2/studionet-smoke.json`. No V2 deployment followed.

Diagnosis: the V2 candidate's v0.6-style dependency/API header is not accepted
by the stable hosted Studionet runtime. This is a source/toolchain compatibility
failure, not a successful smoke, so the release remains blocked pending a new
locally audited candidate compatible with the selected runtime. The V2 source
freeze has not been changed.
