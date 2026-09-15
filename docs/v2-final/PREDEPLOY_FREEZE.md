# MeritRound V2 predeploy freeze

Freeze date: 2026-09-13  
Freeze base commit: `3d5244960b858fcc052e9054992a3c341418646b`  
Audit branch: `v2-steward-liveness`

## Frozen source

- Source: `contracts/meritround_v2.py`
- SHA-256: `6e21cb5f1361f80f5d09d20087122d271edec6c96d7270d44f6234d3b588272b`
- Bytes: `29586`
- Manifest: `deployments/v2/SOURCE_MANIFEST.json`
- Checksums: `deployments/v2/FROZEN_SHA256SUMS.txt`

The V1 source at `contracts/meritround.py` is preserved and is not part of this
freeze. The V2 deploy helper has no source-path override and accepts the
deployment only when the bytes and SHA-256 match this manifest immediately
before the single high-level SDK broadcast.

## Gates completed before freeze

- V2 direct contract tests: 25 passed.
- Frontend tests: 21 passed.
- Frontend and deployment typechecks: passed.
- Production build: passed.
- GenVM lint: 3 checks passed.
- Critical mutations: 11 killed, 0 survived, 0 errors.
- npm audit and npm audit `--omit=dev`: 0 vulnerabilities.
- Python `pip check`: no broken requirements.
- Secret scan: no credential material found; historical tx hashes and V1
  keystore-handling code are not credentials.
- Source parity: the recorded SHA and byte count match this frozen source.

## Network gate still required

This freeze authorizes inspection of the configured network and, only after the
read-only Bradbury fee/health gate passes, a minimal Hello smoke deployment. It
does not authorize publication, GitHub changes, Vercel deployment, or a V2
contract broadcast by itself. Any modification to `contracts/meritround_v2.py`
invalidates this freeze and requires the full local gates to be rerun.
