#!/usr/bin/env python3
"""Hash helpers for Flatpak generated-sources synchronization."""

import hashlib
from pathlib import Path
from typing import Optional, Tuple

from _flatpak_env import repo_root


def compute_sources_hash(lockfile: Path) -> Tuple[str, Path]:
    root = repo_root()
    if not lockfile.is_absolute():
        lockfile = root / lockfile
    if not lockfile.exists():
        raise FileNotFoundError(f"Lockfile not found: {lockfile}")

    digest = hashlib.sha256()
    digest.update(b"flatpak-generated-pnpm-sources-hash-v2\n")
    for path in (lockfile, root / "src/main/duckdb-extensions.json"):
        if not path.exists():
            raise FileNotFoundError(f"Flatpak source input not found: {path}")
        relative = path.relative_to(root).as_posix()
        contents = path.read_bytes()
        digest.update(f"path:{relative}\n".encode("utf-8"))
        digest.update(f"size:{len(contents)}\n".encode("utf-8"))
        digest.update(contents)
        digest.update(b"\n")

    return digest.hexdigest(), lockfile


def read_stored_hash(hash_file: Path) -> Optional[str]:
    if not hash_file.exists():
        return None
    value = hash_file.read_text(encoding="utf-8").strip()
    return value or None


def write_stored_hash(hash_file: Path, value: str) -> None:
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    hash_file.write_text(f"{value}\n", encoding="utf-8")
