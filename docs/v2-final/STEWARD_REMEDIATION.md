# Steward remediation audit

## Requirement A — stronger finalist control

| Requirement | V2 implementation | Local proof |
|---|---|---|
| Registration is separate from selection | `register_submission` only appends to the registration array | V2 direct test: registration leaves `selected_ids` and `finalist_ids` empty |
| Organizer-only selection | `set_finalist` checks the stored organizer | unauthorized-selection test |
| Selection bounds and duplicate guards | `MAX_FINALISTS`, duplicate select/deselect errors | selection guard and max-bound tests |
| Minimum and maximum lock bounds | `MIN_FINALISTS=2`, `MAX_FINALISTS=16` | lock/minimum and maximum tests |
| Deterministic locked order | `sorted(selected_ids)` at lock | canonical-order test |
| Immutable finalist set | selection is `OPEN`-only; lock writes finalist IDs once | post-lock mutation test |
| Unselected submissions excluded | prompt is built from `round_finalist_ids` only | C-exclusion and winner-membership tests |
| Evaluation-universe binding | digest includes exact locked IDs, titles, and committed SHAs | digest readback tests |

## Requirement B — safe unavailable-evidence recovery

| Requirement | V2 implementation | Local proof |
|---|---|---|
| Immutable evidence identity | expected SHA is stored on `SubmissionRecord` and copied into a write-once snapshot | exact-byte and snapshot binding tests |
| Original URL is provenance only | submission ID and universe digest omit the URL | V2 identity test and source review |
| Exact-byte recovery | recovery fetch is hash-checked before snapshot write | wrong-mirror test |
| Recovery cannot alter locked state | recovery writes only `evidence_snapshots` | before/after boundary assertions |
| Missing snapshot blocks safely | resolver rejects missing snapshots before consensus | missing-snapshot test |
| No resolve-time HTTP | resolver iterates stored bytes only | zero-fetch view and cleared-web-mock test |
| Same locked round continues | a failed original pin leaves `LOCKED`; correct recovery then permits resolve | recovery lifecycle test |

The direct suite covers 25 V2 tests. The complete matrix, including frontend and mutation results, is recorded in `TEST_MATRIX.md`.
