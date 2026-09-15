"""Windows compatibility for the installed gltest direct loader.

The current loader unlinks its temporary stdin file before the duplicated
descriptor is released. Windows rejects that unlink. This test-only shim keeps
the same message injection semantics and removes the file during VM cleanup.
"""

import os
import tempfile

from gltest.direct import loader
from gltest.direct import sdk_loader
from gltest.direct.vm import VMContext


def _safe_inject_message_to_fd0(vm: VMContext) -> None:
    try:
        from genlayer.py import calldata
        from genlayer.py.types import Address
    except ModuleNotFoundError:
        # v0.6 runner bundles the standard library as ``genlayer`` rather
        # than the legacy ``genlayer.py`` package used by older gltest.
        from genlayer import Address, calldata

    sender_addr = vm.sender
    if isinstance(sender_addr, bytes):
        sender_addr = Address(sender_addr)
    contract_addr = vm._contract_address
    if isinstance(contract_addr, bytes):
        contract_addr = Address(contract_addr)
    origin_addr = vm.origin
    if isinstance(origin_addr, bytes):
        origin_addr = Address(origin_addr)

    message_data = {
        "contract_address": contract_addr,
        "sender_address": sender_addr,
        "origin_address": origin_addr,
        "stack": [],
        "value": vm._value,
        "datetime": vm._datetime,
        "is_init": False,
        "chain_id": vm._chain_id,
        "entry_kind": 0,
        "entry_data": b"",
        "entry_stage_data": None,
    }
    encoded = calldata.encode(message_data)
    fd, path = tempfile.mkstemp()
    os.write(fd, encoded)
    os.lseek(fd, 0, os.SEEK_SET)
    vm._original_stdin_fd = os.dup(0)
    os.dup2(fd, 0)
    os.close(fd)
    vm._message_temp_path = path


_original_cleanup = VMContext._cleanup_after_deactivate


def _safe_cleanup(self: VMContext) -> None:
    path = getattr(self, "_message_temp_path", None)
    _original_cleanup(self)
    if path is not None:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        self._message_temp_path = None


loader._inject_message_to_fd0 = _safe_inject_message_to_fd0
VMContext._cleanup_after_deactivate = _safe_cleanup

# Stable direct tests select the GenVM bundle from the contract dependency and
# the GENVM_VERSION environment variable.  Do not pin this harness to the
# preview v0.6 bundle: it does not contain the documented stable runner.
