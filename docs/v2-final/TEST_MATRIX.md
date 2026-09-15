# MeritRound V2 local test matrix

All commands are run from the repository root on branch `v2-steward-liveness`.

| Gate | Command | Result |
|---|---|---|
| V2 direct contract tests | `py -3.14 -m pytest -q tests/direct/test_meritround_v2.py` | PASS - 25 passed |
| V1 historical direct tests | `py -3.14 -m pytest -q tests/direct/test_meritround_direct.py` | CLASSIFIED - legacy ABI cannot run on the selected v0.6 runner; V1 source preserved and not a V2 gate |
| Frontend tests | `npm run test:frontend` | PASS - 21 passed |
| Frontend typecheck | `npm run typecheck:frontend` | PASS |
| Deployment typecheck | `npm run typecheck:deploy` | PASS |
| Production build | `npm run build` | PASS |
| GenVM lint | `genvm-lint contracts/meritround_v2.py` | PASS - 3 checks |
| Semantic validation | V2 identity, schema, bounded witness, and terminal-state tests | PASS in V2 direct suite |
| Mutation tests | `py -3.14 scripts/v2_mutation_runner.py` | PASS - 11/11 killed, 0 survivors, 0 errors |
| Dependency audit | `npm audit`, `npm audit --omit=dev`, and `py -3.14 -m pip check` | PASS - 0 npm vulnerabilities; no broken Python requirements |
| Secret scan | tracked source/config credential-pattern scan | PASS - no credential material; historical tx hashes and keystore code classified |
| Source parity | frozen V2 SHA vs release manifest | PASS - SHA and 29,586-byte count match |

## Required critical mutations

The mutation gate must kill mutations for organizer authorization, automatic finalist inclusion, post-lock finalist changes, SHA verification, immutable SHA binding, non-finalist recovery, live fetch in `resolve_round`, missing-snapshot resolution, winner-outside-finalists, and terminal-result mutation.

Old V1 failures are classified separately from V2 defects because V1 intentionally has automatic finalist inclusion and resolve-time evidence fetch semantics.

The Bradbury read-only gate failed on the live FeeManager calls, so no Bradbury
smoke was attempted. The permitted Studionet fallback reached one official
Hello smoke broadcast, which finalized with `ERROR` / `invalid_contract`; it was
tracked by the same transaction ID and never rebroadcast. Consequently no V2
deployment or live steward proof was attempted.
