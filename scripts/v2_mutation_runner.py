"""Run critical V2 security mutations in disposable repository copies.

The canonical checkout is never mutated.  Every mutation must be killed by a
focused V2 direct test; runner or collection failures are reported separately.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = Path("contracts/meritround_v2.py")


MUTATIONS = (
    {
        "id": "bypass-organizer-auth",
        "target": "_require_organizer",
        "test": "tests/direct/test_meritround_v2.py::test_only_organizer_can_select_and_selection_guards_are_strict",
        "old": '        if gl.message.sender_address != round_record.organizer:\n            _fail("BUSINESS_UNAUTHORIZED_ORGANIZER")',
        "new": '        if False:\n            _fail("BUSINESS_UNAUTHORIZED_ORGANIZER")',
    },
    {
        "id": "auto-finalist-all-registrations",
        "target": "lock_round finalist universe",
        "test": "tests/direct/test_meritround_v2.py::test_lock_requires_selected_minimum_and_canonicalizes_order",
        "old": "        selected_ids = self._selected_ids(round_id)\n        if len(selected_ids) < MIN_FINALISTS:",
        "new": "        selected_ids = self._submission_ids(round_id)\n        if len(selected_ids) < MIN_FINALISTS:",
    },
    {
        "id": "allow-finalist-change-after-lock",
        "target": "set_finalist lifecycle guard",
        "test": "tests/direct/test_meritround_v2.py::test_lock_requires_selected_minimum_and_canonicalizes_order",
        "old": '        if round_record.state != STATE_OPEN:\n            if round_record.state in (STATE_FINALIZED, STATE_INCONCLUSIVE):\n                _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")\n            _fail("BUSINESS_ILLEGAL_STATE_FINALIST")',
        "new": '        if False:\n            if round_record.state in (STATE_FINALIZED, STATE_INCONCLUSIVE):\n                _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")\n            _fail("BUSINESS_ILLEGAL_STATE_FINALIST")',
    },
    {
        "id": "skip-evidence-sha-verification",
        "target": "_validate_evidence_document",
        "test": "tests/direct/test_meritround_v2.py::test_pin_and_recovery_authenticate_exact_bytes_and_preserve_boundary",
        "old": '    if hashlib.sha256(body).hexdigest() != expected_sha256:\n        _fail("EVIDENCE_SHA_MISMATCH")',
        "new": '    if False:\n        _fail("EVIDENCE_SHA_MISMATCH")',
    },
    {
        "id": "change-stored-immutable-sha",
        "target": "pin_evidence snapshot commitment",
        "test": "tests/direct/test_meritround_v2.py::test_pin_and_recovery_authenticate_exact_bytes_and_preserve_boundary",
        "old": '        self.evidence_snapshots[submission_id] = EvidenceSnapshotRecord(\n            round_id=round_id,\n            submission_id=submission_id,\n            expected_sha256=submission.expected_sha256,\n            body=body,\n            content=content,\n            source_url=submission.evidence_url,\n        )',
        "new": '        self.evidence_snapshots[submission_id] = EvidenceSnapshotRecord(\n            round_id=round_id,\n            submission_id=submission_id,\n            expected_sha256="0" * 64,\n            body=body,\n            content=content,\n            source_url=submission.evidence_url,\n        )',
    },
    {
        "id": "recover-nonfinalist",
        "target": "recover_evidence finalist guard",
        "test": "tests/direct/test_meritround_v2.py::test_wrong_round_and_nonfinalist_evidence_recovery_fail_closed",
        "old": '        _require_https_url(recovery_url)\n        self._get_submission_for_round(round_id, submission_id)\n        if not _contains(self._locked_ids(round_id), submission_id):\n            _fail("BUSINESS_SUBMISSION_NOT_LOCKED_FINALIST")',
        "new": '        _require_https_url(recovery_url)\n        self._get_submission_for_round(round_id, submission_id)',
    },
    {
        "id": "live-fetch-inside-resolve",
        "target": "resolve_round snapshot source",
        "test": "tests/direct/test_meritround_v2.py::test_resolution_uses_stored_snapshots_and_zero_web_fetches",
        "old": "            content = _validate_evidence_document(snapshot.body, submission.expected_sha256)",
        "new": "            content = _validate_evidence_document(_fetch_evidence_bytes(submission.evidence_url), submission.expected_sha256)",
    },
    {
        "id": "allow-missing-snapshot-resolution",
        "target": "_snapshot_for_locked_submission",
        "test": "tests/direct/test_meritround_v2.py::test_missing_snapshot_blocks_resolution_without_web_fetch",
        "old": '        if snapshot is None:\n            _fail("EVIDENCE_SNAPSHOT_MISSING")',
        "new": "        if False:\n            _fail(\"EVIDENCE_SNAPSHOT_MISSING\")",
    },
    {
        "id": "winner-outside-finalist",
        "target": "_canonicalize_model_result winner guard",
        "test": "tests/direct/test_meritround_v2.py::test_winner_must_be_a_locked_finalist",
        "old": '        if submission_id == "" or not _contains(finalist_ids, submission_id):\n            _fail("SEMANTIC_RESULT_WINNER_NOT_FINALIST")',
        "new": '        if False:\n            _fail("SEMANTIC_RESULT_WINNER_NOT_FINALIST")',
    },
    {
        "id": "terminal-result-mutation",
        "target": "resolve_round terminal guards",
        "test": "tests/direct/test_meritround_v2.py::test_terminal_result_and_evidence_are_immutable",
        "replacements": [
            (
                '        if round_record.state != STATE_LOCKED:\n            if round_record.state in (STATE_FINALIZED, STATE_INCONCLUSIVE):\n                _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")\n            _fail("BUSINESS_RESOLVE_BEFORE_LOCK")',
                '        if False:\n            if round_record.state in (STATE_FINALIZED, STATE_INCONCLUSIVE):\n                _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")\n            _fail("BUSINESS_RESOLVE_BEFORE_LOCK")',
            ),
            (
                '        if self.results.get(round_id) is not None:\n            _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")',
                '        if False:\n            _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")',
            ),
        ],
    },
    {
        "id": "submission-sha-identity-removed",
        "target": "_canonical_submission_material",
        "test": "tests/direct/test_meritround_v2.py::test_submission_identity_binds_expected_sha_but_not_transport_url",
        "old": '            title,\n            expected_sha256,',
        "new": '            title,',
    },
)


def _ignore_copy(_directory: str, names: list[str]) -> set[str]:
    ignored = {".git", ".pytest_cache", "node_modules", "dist", "__pycache__"}
    return {name for name in names if name in ignored or name.startswith(".mutation-")}


def _replace_exact(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"mutation target count was {count}, expected 1")
    path.write_text(source.replace(old, new), encoding="utf-8")


def _run_one(mutation: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {
        "mutation_id": mutation["id"],
        "target": mutation["target"],
        "test": mutation["test"],
    }
    temporary_directory: Path | None = None
    try:
        temporary_directory = ROOT / f".mutation-{uuid.uuid4().hex}"
        temporary_directory.mkdir()
        temporary_root = temporary_directory / "repo"
        shutil.copytree(ROOT, temporary_root, ignore=_ignore_copy)
        contract_path = temporary_root / CONTRACT
        if "replacements" in mutation:
            replacements = mutation["replacements"]
        else:
            replacements = [(mutation["old"], mutation["new"])]
        for old, new in replacements:  # type: ignore[misc]
            _replace_exact(contract_path, old, new)

        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        environment["PYTHONIOENCODING"] = "utf-8"
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-p",
                "no:cacheprovider",
                "-q",
                mutation["test"],
            ],
            cwd=temporary_root,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
        )
        output = (completed.stdout + "\n" + completed.stderr).strip()
        result["return_code"] = completed.returncode
        result["output_tail"] = output[-2500:]
        tooling_markers = (
            "ModuleNotFoundError",
            "FileNotFoundError",
            "No tests ran",
            "INTERNALERROR",
            "ImportError while loading conftest",
            "mutation target count",
        )
        failure_markers = ("DID NOT RAISE", "AssertionError", "Failed", "error message mismatch", "UserError")
        if completed.returncode == 0:
            result["status"] = "SURVIVED"
        elif any(marker in output for marker in tooling_markers):
            result["status"] = "ERROR"
        elif any(marker in output for marker in failure_markers):
            result["status"] = "KILLED"
        else:
            result["status"] = "ERROR"
    except subprocess.TimeoutExpired as error:
        result["status"] = "ERROR"
        result["error"] = f"pytest timeout: {error}"
    except Exception as error:  # pragma: no cover - runner boundary
        result["status"] = "ERROR"
        result["error"] = str(error)
    finally:
        if temporary_directory is not None:
            shutil.rmtree(temporary_directory, ignore_errors=True)
    return result


def main() -> int:
    results = [_run_one(mutation) for mutation in MUTATIONS]
    summary = {
        "tested": len(results),
        "killed": sum(item.get("status") == "KILLED" for item in results),
        "survived": sum(item.get("status") == "SURVIVED" for item in results),
        "errors": sum(item.get("status") == "ERROR" for item in results),
        "results": results,
    }
    print("V2_MUTATION_RESULTS=" + json.dumps(summary, sort_keys=True))
    return 0 if summary["killed"] == summary["tested"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
