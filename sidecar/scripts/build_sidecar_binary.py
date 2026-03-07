#!/usr/bin/env python3
"""Build a standalone sidecar executable and place it in sidecar/bin."""

from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    sidecar_dir = Path(__file__).resolve().parents[1]
    binary_name = (
        "cortex-sidecar.exe"
        if platform.system().lower().startswith("win")
        else "cortex-sidecar"
    )

    pyinstaller_cmd = [
        "uvx",
        "pyinstaller",
        "--onefile",
        "--name",
        "cortex-sidecar",
        "cortex_sidecar/main.py",
    ]

    subprocess.run(pyinstaller_cmd, cwd=sidecar_dir, check=True)

    dist_binary = sidecar_dir / "dist" / binary_name
    if not dist_binary.exists():
        raise FileNotFoundError(f"Expected binary not found: {dist_binary}")

    output_dir = sidecar_dir / "bin"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_binary = output_dir / binary_name
    shutil.copy2(dist_binary, output_binary)

    print(f"Built sidecar binary: {output_binary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
