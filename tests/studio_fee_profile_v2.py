"""RC v0.6 fee-profile scenario for the frozen MeritRound V2 source.

Run with the RC gltest executable and an isolated localnet, for example:

    gltest tests/studio_fee_profile_v2.py -s -v \
      --network localnet --rpc-url http://127.0.0.1:5100/api \
      --chain-type localnet \
      --fee-profile deployments/v2/fee-profile.v2.json \
      --fee-profile-headroom 1.5

The scenario intentionally includes one failed evidence fetch and one failed
wrong-byte recovery.  gltest records finalized receipts for those writes too,
which gives the profile coverage for the fail-closed branches without
weakening the contract or treating a failed business execution as success.
"""

import base64
import hashlib
import json

from gltest import get_contract_factory, get_gl_client
from gltest.assertions import tx_execution_failed, tx_execution_succeeded
from gltest.utils import extract_contract_address


def _evidence_body(label: str) -> bytes:
    return json.dumps(
        {"version": 1, "content": label},
        separators=(",", ":"),
    ).encode("utf-8")


def _httpbin_body_url(body: bytes) -> str:
    encoded = base64.urlsafe_b64encode(body).decode("ascii").rstrip("=")
    return f"https://httpbin.org/base64/{encoded}"


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _finalized_write(contract_function, args, fees):
    return contract_function(args=args).transact(
        fees=fees,
        wait_until="finalized",
        wait_interval=1_000,
        wait_retries=600,
    )


def _require_success(receipt, label: str) -> None:
    assert tx_execution_succeeded(receipt), f"{label} execution failed: {receipt}"


def test_profile_frozen_meritround_v2_write_surface():
    # gltest resolves file paths relative to its configured contracts
    # directory, so the contract filename (not the repo-relative path) is
    # intentional here.
    fee_quote = get_gl_client().estimate_transaction_fees()
    assert fee_quote.get("distribution"), fee_quote
    assert int(fee_quote.get("fee_value", 0)) > 0, fee_quote

    factory = get_contract_factory(contract_file_path="meritround_v2.py")
    contract = factory.deploy(
        fees=fee_quote,
        wait_until="finalized",
        wait_interval=1_000,
        wait_retries=600,
    )

    body_a = _evidence_body("fee profile evidence A")
    body_b = _evidence_body("fee profile evidence B")
    body_wrong = _evidence_body("wrong mirror bytes")
    url_a = _httpbin_body_url(body_a)
    url_b_mirror = _httpbin_body_url(body_b)
    url_wrong_mirror = _httpbin_body_url(body_wrong)
    unavailable_url = "https://unavailable.invalid/meritround-v2-b.json"

    _require_success(
        _finalized_write(
            contract.create_round,
            [
                "Fee Profile V2",
                "Measured RC write surface",
                "Prefer clear evidence and useful outcomes.",
            ],
            fee_quote,
        ),
        "create_round",
    )
    round_id = contract.get_round_ids().call()[0]

    _require_success(
        _finalized_write(contract.open_round, [round_id], fee_quote),
        "open_round",
    )

    for title, url, body in (
        ("Profile A", url_a, body_a),
        ("Profile B", unavailable_url, body_b),
        ("Profile C", url_a, body_a),
    ):
        _require_success(
            _finalized_write(
                contract.register_submission,
                [round_id, title, url, _sha256(body)],
                fee_quote,
            ),
            "register_submission",
        )

    submission_ids = contract.get_round_submission_ids(round_id).call()
    submission_a, submission_b, submission_c = submission_ids

    _require_success(
        _finalized_write(
            contract.set_finalist,
            [round_id, submission_a, True],
            fee_quote,
        ),
        "set_finalist(A)",
    )
    _require_success(
        _finalized_write(
            contract.set_finalist,
            [round_id, submission_b, True],
            fee_quote,
        ),
        "set_finalist(B)",
    )
    _require_success(
        _finalized_write(contract.lock_round, [round_id], fee_quote),
        "lock_round",
    )

    _require_success(
        _finalized_write(contract.pin_evidence, [round_id, submission_a], fee_quote),
        "pin_evidence(A)",
    )

    unavailable_receipt = _finalized_write(
        contract.pin_evidence,
        [round_id, submission_b],
        fee_quote,
    )
    assert tx_execution_failed(unavailable_receipt), unavailable_receipt

    wrong_recovery_receipt = _finalized_write(
        contract.recover_evidence,
        [round_id, submission_b, url_wrong_mirror],
        fee_quote,
    )
    assert tx_execution_failed(wrong_recovery_receipt), wrong_recovery_receipt

    _require_success(
        _finalized_write(
            contract.recover_evidence,
            [round_id, submission_b, url_b_mirror],
            fee_quote,
        ),
        "recover_evidence(correct mirror)",
    )

    # Resolve is intentionally attempted after all authenticated snapshots
    # exist.  This exercises the nondeterministic consensus path and is also
    # recorded if the local provider reports a finalized execution failure.
    resolve_receipt = _finalized_write(contract.resolve_round, [round_id], fee_quote)
    assert resolve_receipt.get("status") is not None, resolve_receipt

    # Keep the readbacks in the test output for the profile provenance.  They
    # are views only and do not contribute any fee values.
    print(
        json.dumps(
            {
                "contract_address": contract.address,
                "deployment_address": extract_contract_address(
                    {"data": {"contract_address": contract.address}}
                ),
                "round_id": round_id,
                "submission_ids": submission_ids,
                "finalist_ids": contract.get_round_finalist_ids(round_id).call(),
                "evidence_a": contract.get_evidence_status(
                    round_id, submission_a
                ).call(),
                "evidence_b": contract.get_evidence_status(
                    round_id, submission_b
                ).call(),
                "round": contract.get_round(round_id).call(),
                "result": contract.get_result(round_id).call(),
                "resolve_execution_succeeded": tx_execution_succeeded(
                    resolve_receipt
                ),
                "unselected_submission": submission_c,
            },
            indent=2,
            default=str,
        )
    )
