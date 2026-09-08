"""Direct Bradbury outer ConsensusMain submission helper.

This is deliberately limited to one already-authorized MeritRound operation at
a time.  It ports the exact genlayer-js 1.1.8 calldata and addTransaction
encoding, but sends only through the direct chain RPC with an explicit gas
limit.  The encrypted keystore is decrypted in memory and the private key is
never printed or written back to disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests
import rlp
from eth_account import Account
from eth_abi import encode as abi_encode
from eth_utils import keccak


CONSENSUS_MAIN = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D"
MERITROUND_RECIPIENT = "0x06404943AbFC5Da4c2fC664d5d17339F5f52F65e"
CHAIN_ID = 4221
NUM_INITIAL_VALIDATORS = 5
MAX_ROTATIONS = 3
NEW_TRANSACTION_TOPIC = keccak(b"NewTransaction(bytes32,address,address)").hex()


class RpcFailure(RuntimeError):
    pass


def rpc(url: str, method: str, params: list[Any] | None = None) -> Any:
    response = requests.post(
        url,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []},
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()
    if body.get("error") is not None:
        raise RpcFailure(f"{method}: {json.dumps(body['error'], sort_keys=True)}")
    return body.get("result")


def write_num(output: list[int], value: int) -> None:
    if value == 0:
        output.append(0)
        return
    while value > 0:
        current = value & 0x7F
        value >>= 7
        if value > 0:
            current |= 0x80
        output.append(current)


def encode_num_with_type(output: list[int], value: int, type_code: int) -> None:
    write_num(output, (value << 3) | type_code)


def compare_code_points(left: list[int], right: list[int]) -> int:
    for left_value, right_value in zip(left, right):
        if left_value != right_value:
            return -1 if left_value < right_value else 1
    return (len(left) > len(right)) - (len(left) < len(right))


def encode_value(output: list[int], value: Any) -> None:
    # These codes and ordering mirror src/abi/calldata/encoder.ts in
    # genlayer-js 1.1.8 exactly.
    if value is None:
        output.append(0)
    elif value is False:
        output.append(8)
    elif value is True:
        output.append(16)
    elif isinstance(value, int):
        if value >= 0:
            encode_num_with_type(output, value, 1)
        else:
            encode_num_with_type(output, -value - 1, 2)
    elif isinstance(value, bytes):
        encode_num_with_type(output, len(value), 3)
        output.extend(value)
    elif isinstance(value, str):
        encoded = value.encode("utf-8")
        encode_num_with_type(output, len(encoded), 4)
        output.extend(encoded)
    elif isinstance(value, list):
        encode_num_with_type(output, len(value), 5)
        for item in value:
            encode_value(output, item)
    elif isinstance(value, dict):
        entries = []
        for key, item in value.items():
            code_points = [ord(character) for character in key]
            entries.append((code_points, key.encode("utf-8"), item))
        entries.sort(key=lambda item: item[0])
        for previous, current in zip(entries, entries[1:]):
            if compare_code_points(previous[0], current[0]) == 0:
                raise ValueError(f"duplicate key {current[1]!r}")
        encode_num_with_type(output, len(entries), 6)
        for _, key_bytes, item in entries:
            write_num(output, len(key_bytes))
            output.extend(key_bytes)
            encode_value(output, item)
    else:
        raise TypeError(f"unsupported GenLayer calldata value: {type(value)!r}")


def encode_calldata_object(method: str, args: list[Any]) -> bytes:
    object_value = {"method": method, "args": args}
    output: list[int] = []
    encode_value(output, object_value)
    return bytes(output)


def make_app_calldata(method: str, args: list[Any]) -> bytes:
    # genlayer-js transactions.serialize([toHex(encoded), toHex(false)])
    # is an RLP list containing the encoded GenVM object and the single zero
    # byte produced by viem's toHex(false) (0x0).
    return rlp.encode([encode_calldata_object(method, args), b"\x00"])


def make_outer_calldata(
    sender: str,
    recipient: str,
    method: str,
    args: list[Any],
    valid_until: int,
) -> bytes:
    selector = keccak(b"addTransaction(address,address,uint256,uint256,bytes,uint256)")[:4]
    encoded_args = abi_encode(
        ["address", "address", "uint256", "uint256", "bytes", "uint256"],
        [
            sender,
            recipient,
            NUM_INITIAL_VALIDATORS,
            MAX_ROTATIONS,
            make_app_calldata(method, args),
            valid_until,
        ],
    )
    return selector + encoded_args


def build_transaction(
    sender: str,
    method: str,
    args: list[Any],
    valid_until: int,
) -> tuple[bytes, dict[str, Any]]:
    data = make_outer_calldata(sender, MERITROUND_RECIPIENT, method, args, valid_until)
    return data, {
        "method": method,
        "outer_evm_to": CONSENSUS_MAIN,
        "recipient": MERITROUND_RECIPIENT,
        "value": "0x0",
        "num_initial_validators": NUM_INITIAL_VALIDATORS,
        "max_rotations": MAX_ROTATIONS,
        "valid_until": valid_until,
        "calldata_bytes": len(data),
        "calldata_keccak": "0x" + keccak(data).hex(),
    }


def load_account(keystore_path: Path, password: str):
    # Account.decrypt returns the key only in this process; do not log it.
    keystore = json.loads(keystore_path.read_text(encoding="utf-8"))
    private_key = Account.decrypt(keystore, password)
    return Account.from_key(private_key)


def padded_address(address: str) -> str:
    return "0x" + "0" * 24 + address[2:].lower()


def recover_genlayer_tx_id(receipt: dict[str, Any], recipient: str) -> list[str]:
    matches = []
    for log in receipt.get("logs", []):
        topics = log.get("topics", [])
        if (
            log.get("address", "").lower() == CONSENSUS_MAIN.lower()
            and len(topics) == 4
            and topics[0].lower() == "0x" + NEW_TRANSACTION_TOPIC
            and topics[2].lower() == padded_address(recipient).lower()
        ):
            matches.append(topics[1])
    return matches


def args_for(method: str, round_id: str) -> list[Any]:
    if method in {"lock_round", "resolve_round"}:
        return [round_id]
    raise ValueError(f"unsupported operation: {method}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=["prepare", "estimate", "send"], required=True)
    parser.add_argument("--method", choices=["lock_round", "resolve_round"], required=True)
    parser.add_argument("--round-id", required=True)
    parser.add_argument("--sender", required=True)
    parser.add_argument("--chain-rpc", default="https://rpc.testnet-chain.genlayer.com")
    parser.add_argument("--valid-until", type=int)
    parser.add_argument("--gas-limit", type=int)
    parser.add_argument("--keystore", type=Path)
    parser.add_argument("--password-env", default="MERITROUND_KEYSTORE_PASSWORD")
    parser.add_argument("--record-path", type=Path)
    args = parser.parse_args()

    valid_until = args.valid_until or int(time.time()) + 3600
    data, metadata = build_transaction(
        args.sender,
        args.method,
        args_for(args.method, args.round_id),
        valid_until,
    )
    if args.action == "prepare":
        print(json.dumps(metadata, sort_keys=True))
        return 0

    if args.action == "estimate":
        estimate = rpc(
            args.chain_rpc,
            "eth_estimateGas",
            [
                {
                    "from": args.sender,
                    "to": CONSENSUS_MAIN,
                    "value": "0x0",
                    "data": "0x" + data.hex(),
                }
            ],
        )
        metadata["direct_chain_estimate"] = estimate
        raw_estimate = int(estimate, 16) if isinstance(estimate, str) else int(estimate)
        metadata["two_x_gas_limit"] = raw_estimate * 2
        print(json.dumps(metadata, sort_keys=True))
        return 0

    if args.gas_limit is None:
        raise ValueError("--gas-limit is required for --action send")
    if args.keystore is None:
        raise ValueError("--keystore is required for --action send")
    password = os.environ.get(args.password_env)
    if not password:
        raise ValueError(f"missing keystore password environment variable {args.password_env}")
    account = load_account(args.keystore, password)
    if account.address.lower() != args.sender.lower():
        raise ValueError("keystore account does not match --sender")

    nonce_hex = rpc(args.chain_rpc, "eth_getTransactionCount", [args.sender, "latest"])
    pending_nonce_hex = rpc(args.chain_rpc, "eth_getTransactionCount", [args.sender, "pending"])
    if nonce_hex != pending_nonce_hex:
        raise ValueError(f"nonce changed before signing: latest={nonce_hex} pending={pending_nonce_hex}")
    gas_price = rpc(args.chain_rpc, "eth_gasPrice")
    transaction = {
        "nonce": int(nonce_hex, 16),
        "gasPrice": int(gas_price, 16),
        "gas": args.gas_limit,
        "to": CONSENSUS_MAIN,
        "value": 0,
        "data": "0x" + data.hex(),
        "chainId": CHAIN_ID,
    }
    signed = Account.sign_transaction(transaction, account.key)
    raw_hash = rpc(args.chain_rpc, "eth_sendRawTransaction", [signed.raw_transaction.hex()])
    result: dict[str, Any] = {
        **metadata,
        "nonce": nonce_hex,
        "pending_nonce": pending_nonce_hex,
        "gas_price": gas_price,
        "explicit_gas_limit": args.gas_limit,
        "evm_submission_hash": raw_hash,
    }
    if args.record_path is not None:
        args.record_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    receipt = None
    for _ in range(120):
        receipt = rpc(args.chain_rpc, "eth_getTransactionReceipt", [raw_hash])
        if receipt is not None:
            break
        time.sleep(5)
    if receipt is None:
        raise TimeoutError(f"EVM receipt not available for {raw_hash}")
    result["evm_receipt"] = {
        "status": receipt.get("status"),
        "gas_used": receipt.get("gasUsed"),
        "effective_gas_price": receipt.get("effectiveGasPrice"),
        "block_number": receipt.get("blockNumber"),
    }
    if args.record_path is not None:
        args.record_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if receipt.get("status") != "0x1":
        print(json.dumps(result, sort_keys=True), file=sys.stderr)
        return 2
    ids = recover_genlayer_tx_id(receipt, "0x06404943AbFC5Da4c2fC664d5d17339F5f52F65e")
    result["genlayer_tx_ids"] = ids
    if args.record_path is not None:
        args.record_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    if len(ids) != 1:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
