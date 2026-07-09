"""Direct-test compatibility helpers.

On Windows with Python 3.14, genlayer-test may try to unlink the temporary
stdin file while the duplicated descriptor is still considered in use. Ignoring
that specific cleanup PermissionError lets the direct VM continue; the OS temp
cleaner can remove the file later.
"""

import os


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
