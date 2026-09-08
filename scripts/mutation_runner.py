"""Run the recovered Hour-5 MeritRound mutations in disposable copies.

This runner never edits the canonical checkout.  Each mutation is applied to a
temporary copy and is considered killed only when its mapped pytest security
test fails with test-level evidence.  Collection/import/tooling failures are
reported as ERROR, never counted as kills.
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
CONTRACT_RELATIVE = Path("contracts/meritround.py")


AVAILABILITY_TEST = '''
import hashlib
import json

import pytest


URL_A = "https://evidence.example/a.json"
URL_B = "https://evidence.example/b.json"


def evidence_body(content: str) -> str:
    return json.dumps({"version": 1, "content": content}, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def test_unavailable_evidence_cannot_become_winner(direct_deploy, direct_vm):
    contract = direct_deploy("contracts/meritround.py")
    round_id = contract.create_round("Open Design Challenge", "A direct fixture.", "Prefer evidence.")
    contract.open_round(round_id)
    body_a = evidence_body("clear evidence A")
    body_b = evidence_body("clear evidence B")
    contract.register_submission(round_id, "Submission A", URL_A, sha256_text(body_a))
    contract.register_submission(round_id, "Submission B", URL_B, sha256_text(body_b))
    contract.lock_round(round_id)

    with direct_vm.expect_revert("EVIDENCE_AVAILABILITY"):
        contract.resolve_round(round_id)

    assert contract.get_round(round_id)["state"] == "LOCKED"
    assert contract.get_result(round_id) == {"exists": False}
'''.lstrip()


MUTATIONS = (
    {
        "mutation_id": "organizer-check-removed",
        "target_file_or_behavior": "contracts/meritround.py::_require_organizer",
        "mutation_description": "Remove the organizer identity check.",
        "expected_test_failure": "BUSINESS_UNAUTHORIZED_ORGANIZER must remain enforced.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_unauthorized_organizer_action",
        "replacement": (
            'if gl.message.sender_address != round_record.organizer:\n            _fail("BUSINESS_UNAUTHORIZED_ORGANIZER")',
            'if False:\n            _fail("BUSINESS_UNAUTHORIZED_ORGANIZER")',
        ),
    },
    {
        "mutation_id": "locked-state-check-removed",
        "target_file_or_behavior": "contracts/meritround.py::register_submission",
        "mutation_description": "Remove the OPEN-state requirement for submissions.",
        "expected_test_failure": "Submission and open-state mutation after lock must remain rejected.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_mutation_after_lock_rejected",
        "replacement": (
            'if round_record.state != STATE_OPEN:\n            _fail("BUSINESS_ILLEGAL_STATE_SUBMISSION")',
            'if False:\n            _fail("BUSINESS_ILLEGAL_STATE_SUBMISSION")',
        ),
    },
    {
        "mutation_id": "sha-equality-bypassed",
        "target_file_or_behavior": "contracts/meritround.py::_validate_evidence_document",
        "mutation_description": "Bypass the committed SHA-256 equality check.",
        "expected_test_failure": "Tampered evidence must remain rejected with EVIDENCE_SHA_MISMATCH.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_sha_mismatch_fails_closed",
        "replacement": (
            'if hashlib.sha256(body).hexdigest() != expected_sha256:\n        _fail("EVIDENCE_SHA_MISMATCH")',
            'if False:\n        _fail("EVIDENCE_SHA_MISMATCH")',
        ),
    },
    {
        "mutation_id": "winner-membership-check-removed",
        "target_file_or_behavior": "contracts/meritround.py::_validate_model_result",
        "mutation_description": "Remove the requirement that a WINNER is a locked finalist.",
        "expected_test_failure": "A non-finalist winner must remain rejected.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_winner_id_not_in_finalist_set_fails_closed",
        "replacement": (
            'if submission_id == "" or submission_id not in finalist_ids:\n            _fail("SEMANTIC_RESULT_WINNER_NOT_FINALIST")',
            'if False:\n            _fail("SEMANTIC_RESULT_WINNER_NOT_FINALIST")',
        ),
    },
    {
        "mutation_id": "malformed-result-keys-accepted",
        "target_file_or_behavior": "contracts/meritround.py::_validate_model_result",
        "mutation_description": "Allow malformed or extra result keys.",
        "expected_test_failure": "Only the canonical outcome/submission_id schema must be accepted.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_malformed_or_invalid_model_result_fails_closed",
        "replacement": (
            'if sorted(list(result.keys())) != ["outcome", "submission_id"]:\n        _fail("SEMANTIC_RESULT_FORBIDDEN_KEYS")',
            'if False:\n        _fail("SEMANTIC_RESULT_FORBIDDEN_KEYS")',
        ),
    },
    {
        "mutation_id": "inconclusive-winner-allowed",
        "target_file_or_behavior": "contracts/meritround.py::_validate_model_result",
        "mutation_description": "Allow INCONCLUSIVE results to contain a winner submission ID.",
        "expected_test_failure": "INCONCLUSIVE must not contain a winner.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_inconclusive_cannot_contain_winner",
        "replacement": (
            'if submission_id != "":\n            _fail("SEMANTIC_RESULT_INCONCLUSIVE_HAS_WINNER")',
            'if False:\n            _fail("SEMANTIC_RESULT_INCONCLUSIVE_HAS_WINNER")',
        ),
    },
    {
        "mutation_id": "terminal-overwrite-permitted",
        "target_file_or_behavior": "contracts/meritround.py::resolve_round precondition",
        "mutation_description": "Allow resolve_round to proceed before LOCKED, including terminal states.",
        "expected_test_failure": "Terminal and pre-lock state invariants must remain enforced.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_terminal_state_mutation_rejected",
        "replacements": [
            (
                'if round_record.state != STATE_LOCKED:\n            if round_record.state in (STATE_FINALIZED, STATE_INCONCLUSIVE):\n                _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")\n            _fail("BUSINESS_RESOLVE_BEFORE_LOCK")',
                'if False:\n            if round_record.state in (STATE_FINALIZED, STATE_INCONCLUSIVE):\n                _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")\n            _fail("BUSINESS_RESOLVE_BEFORE_LOCK")',
            ),
            (
                'if self.results.get(round_id) is not None:\n            _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")',
                'if False:\n            _fail("BUSINESS_TERMINAL_RESULT_IMMUTABLE")',
            ),
        ],
    },
    {
        "mutation_id": "duplicate-overwrite-permitted",
        "target_file_or_behavior": "contracts/meritround.py::register_submission",
        "mutation_description": "Remove duplicate submission protection.",
        "expected_test_failure": "Duplicate submission IDs must remain rejected.",
        "test_spec": "tests/direct/test_meritround_direct.py::test_duplicate_submission_rejected",
        "replacement": (
            'if self.submissions.get(submission_id) is not None:\n            _fail("BUSINESS_DUPLICATE_SUBMISSION")',
            'if False:\n            _fail("BUSINESS_DUPLICATE_SUBMISSION")',
        ),
    },
    {
        "mutation_id": "unavailable-evidence-bypassed-to-model",
        "target_file_or_behavior": "contracts/meritround.py::_fetch_evidence",
        "mutation_description": "Replace evidence fetching and availability validation with unverified text.",
        "expected_test_failure": "Unavailable evidence must fail closed before semantic resolution.",
        "test_spec": "tests/direct/test_mutation_availability.py::test_unavailable_evidence_cannot_become_winner",
        "replacement": (
            'def _fetch_evidence(evidence_url: str, expected_sha256: str) -> str:\n    try:\n        response = gl.nondet.web.get(evidence_url)\n    except Exception:\n        _fail("EVIDENCE_AVAILABILITY")\n    if response.status != 200 or response.body is None:\n        _fail("EVIDENCE_AVAILABILITY")\n    return _validate_evidence_document(response.body, expected_sha256)',
            'def _fetch_evidence(evidence_url: str, expected_sha256: str) -> str:\n    return "unverified unavailable evidence"',
        ),
        "temporary_test": AVAILABILITY_TEST,
    },
)


def _ignore_copy(_directory: str, names: list[str]) -> set[str]:
    ignored = {".git", ".pytest_cache", "node_modules", "dist", "__pycache__"}
    return {
        name
        for name in names
        if name in ignored or name.startswith(".mutation-")
    }


def _apply_mutation(contract_path: Path, replacement: tuple[str, str]) -> None:
    source = contract_path.read_text(encoding="utf-8")
    old, new = replacement
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"mutation target count was not exactly one: {count}")
    contract_path.write_text(source.replace(old, new), encoding="utf-8")


def _run_one(mutation: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {
        "mutation_id": mutation["mutation_id"],
        "target_file_or_behavior": mutation["target_file_or_behavior"],
        "mutation_description": mutation["mutation_description"],
        "expected_test_failure": mutation["expected_test_failure"],
        "test_spec": mutation["test_spec"],
    }
    temporary_directory: Path | None = None
    cleanup_error: Exception | None = None
    try:
        temporary_directory = ROOT / f".mutation-{uuid.uuid4().hex}"
        temporary_directory.mkdir()
        temporary_root = temporary_directory / "repo"
        shutil.copytree(ROOT, temporary_root, ignore=_ignore_copy)
        if "replacements" in mutation:
            replacements = mutation["replacements"]
        else:
            replacements = [mutation["replacement"]]
        for replacement in replacements:
            _apply_mutation(temporary_root / CONTRACT_RELATIVE, replacement)  # type: ignore[arg-type]
        if "temporary_test" in mutation:
            test_path = temporary_root / "tests/direct/test_mutation_availability.py"
            test_path.write_text(mutation["temporary_test"], encoding="utf-8")  # type: ignore[arg-type]

        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-p",
                "no:cacheprovider",
                "-q",
                mutation["test_spec"],
            ],
            cwd=temporary_root,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
        )
        output = (completed.stdout + "\n" + completed.stderr).strip()
        result["return_code"] = completed.returncode
        result["output_tail"] = output[-4000:]
        tooling_markers = (
            "ModuleNotFoundError",
            "FileNotFoundError",
            "No tests ran",
            "INTERNALERROR",
            "ImportError while loading conftest",
        )
        test_failure_markers = (
            "DID NOT RAISE",
            "AssertionError",
            "Failed",
            "error message mismatch",
        )
        if completed.returncode == 0:
            result["status"] = "SURVIVED"
        elif any(marker in output for marker in tooling_markers):
            result["status"] = "ERROR"
        elif any(marker in output for marker in test_failure_markers):
            result["status"] = "KILLED"
        else:
            result["status"] = "ERROR"
    except subprocess.TimeoutExpired as error:
        result["status"] = "ERROR"
        result["error"] = f"pytest timeout: {error}"
    except Exception as error:  # pragma: no cover - defensive runner boundary
        result["status"] = "ERROR"
        result["error"] = f"runner error: {error}"
    finally:
        if temporary_directory is not None:
            try:
                shutil.rmtree(temporary_directory)
            except Exception as error:  # pragma: no cover - platform cleanup boundary
                cleanup_error = error
    if cleanup_error is not None:
        result["status"] = "ERROR"
        result["error"] = f"temporary-copy cleanup error: {cleanup_error}"
    return result


def main() -> int:
    results = [_run_one(mutation) for mutation in MUTATIONS]
    killed = sum(result.get("status") == "KILLED" for result in results)
    summary = {
        "tested": len(results),
        "killed": killed,
        "survived": sum(result.get("status") == "SURVIVED" for result in results),
        "errors": sum(result.get("status") == "ERROR" for result in results),
        "results": results,
    }
    print("MUTATION_RESULTS=" + json.dumps(summary, sort_keys=True))
    return 0 if summary["tested"] == 9 and summary["killed"] == 9 and summary["survived"] == 0 and summary["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
