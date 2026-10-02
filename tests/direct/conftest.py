"""Direct-test compatibility helpers.

On Windows with Python 3.14, genlayer-test may try to unlink the temporary
stdin file while the duplicated descriptor is still considered in use. Ignoring
that specific cleanup PermissionError lets the direct VM continue; the OS temp
cleaner can remove the file later.
"""

import os
import pytest


_real_unlink = os.unlink


def _windows_tolerant_unlink(path, *args, **kwargs):
    try:
        return _real_unlink(path, *args, **kwargs)
    except PermissionError:
        if os.name == "nt":
            return None
        raise


def pytest_configure():
    if os.name == "nt":
        os.unlink = _windows_tolerant_unlink


@pytest.fixture(params=["split", "monolith"])
def direct_deploy(direct_vm, direct_deploy, monkeypatch, request):
    """Route real SDK view calls to the three deployed stateless helpers.

    Only the transport is replaced. Helper methods and consensus callbacks run
    unchanged. StudioNet tests cover actual sub-VM boundaries.
    """
    original = direct_deploy

    def deploy(path, *args, **kwargs):
        if str(path).replace('\\', '/') != 'contracts/verdict_proof.py' or args or kwargs:
            return original(path, *args, **kwargs)
        if request.param == "monolith":
            return original("tests/reference/verdict_proof_v26_monolith.py")
        from types import SimpleNamespace
        helpers = {}
        addresses = ['0x' + digit * 40 for digit in ('1', '2', '3')]
        for name, address in zip(('provenance', 'receipt', 'review'), addresses):
            import sys
            runtime = sys.modules.get('genlayer.gl.genvm_contracts')
            if runtime is not None:
                monkeypatch.setattr(runtime, '__known_contract__', None)
            helpers[address] = original(f'contracts/proof_{name}.py')
        from genlayer import gl
        original_get = gl.get_contract_at

        def get(address):
            key = address.as_hex.lower()
            if key not in helpers:
                return original_get(address)
            if getattr(direct_vm, '_in_nondet', False):
                raise RuntimeError('Cross-contract call inside nondeterministic block')
            return SimpleNamespace(view=lambda: helpers[key])

        monkeypatch.setattr(gl, 'get_contract_at', get)
        from genlayer.gl import genvm_contracts
        monkeypatch.setattr(genvm_contracts, '__known_contract__', None)
        return original(path, *addresses)

    return deploy
