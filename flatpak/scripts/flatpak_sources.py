#!/usr/bin/env python3
"""Generate and sync Flatpak source manifests for pnpm and NuGet inputs."""

import argparse
import hashlib
import json
import re
import tempfile
import urllib.request
from pathlib import Path
from typing import Iterable, List, Optional

from _flatpak_env import (
    ensure_flatpak_ref,
    ensure_flathub_remote,
    ensure_venv,
    repo_root,
    run_command,
)
from _flatpak_nuget_hash import (
    collect_nuget_input_files,
    compute_nuget_sources_hash,
    read_stored_hash as read_nuget_stored_hash,
    write_stored_hash as write_nuget_stored_hash,
)
from _flatpak_pnpm_hash import (
    compute_sources_hash,
    read_stored_hash as read_sources_stored_hash,
    write_stored_hash as write_sources_stored_hash,
)


DEFAULT_LOCKFILE = "pnpm-lock.yaml"
DEFAULT_PNPM_OUTPUT = "flatpak/generated-sources.json"
DEFAULT_PNPM_HASH_FILE = "flatpak/generated-sources.hash"
DEFAULT_NUGET_SEARCH_ROOT = "tools/dotnetprobe"
DEFAULT_NUGET_OUTPUT = "flatpak/generated-nuget-sources.json"
DEFAULT_NUGET_HASH_FILE = "flatpak/generated-nuget-sources.hash"
DEFAULT_DOTNET = "9"
DEFAULT_FREEDESKTOP = "25.08"
DEFAULT_DESTDIR = "flatpak-nuget-sources"
DEFAULT_RUNTIME = "linux-x64"


def generate_sources(
    lockfile: Path,
    output: Path,
) -> None:
    info = ensure_venv(install_packages=True)

    root = repo_root()

    with tempfile.NamedTemporaryFile(
        dir=root, prefix=".flatpak-pnpm-lock-", suffix=".yaml", delete=False
    ) as temporary:
        generation_lockfile = Path(temporary.name)

    try:
        run_command(
            [
                str(info.python_exe),
                str(Path(__file__).with_name("_flatpak_pnpm_lock.py")),
                str(lockfile),
                str(generation_lockfile),
            ],
            cwd=root,
        )

        run_command(
            [
                str(info.flatpak_node_generator),
                "pnpm",
                str(generation_lockfile),
                "-o",
                str(output),
                "--pnpm-store-version",
                "v11",
            ],
            cwd=root,
        )

        duckdb_sources = _duckdb_extension_sources(lockfile)
        generated_sources = json.loads(output.read_text(encoding="utf-8"))
        generated_sources.extend(duckdb_sources)
        output.write_text(
            json.dumps(generated_sources, indent=4) + "\n",
            encoding="utf-8",
        )
    finally:
        generation_lockfile.unlink(missing_ok=True)


def _duckdb_extension_sources(lockfile: Path) -> List[dict]:
    root = repo_root()
    lock_contents = lockfile.read_text(encoding="utf-8")
    version_match = re.search(
        r"^  '@duckdb/node-api@(\d+\.\d+\.\d+)-r\.\d+':$",
        lock_contents,
        re.MULTILINE,
    )
    if version_match is None:
        raise ValueError(f"{lockfile}: could not find the DuckDB Node API version")
    version = f"v{version_match.group(1)}"

    config_path = root / "src/main/duckdb-extensions.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    platforms = [
        platform for platform in config["platforms"] if platform.startswith("linux_")
    ]
    if not platforms:
        raise ValueError(f"{config_path}: no Linux DuckDB platform is configured")

    sources = []
    for extension in config["extensions"]:
        name = extension["name"]
        extension_type = extension["type"]
        if extension_type == "community":
            base_url = "https://community-extensions.duckdb.org"
        elif extension_type == "http":
            base_url = extension.get("repository")
            if not base_url:
                raise ValueError(
                    f"{config_path}: HTTP extension {name} has no repository"
                )
        else:
            raise ValueError(
                f"{config_path}: unsupported extension type {extension_type}"
            )

        for platform in platforms:
            url = (
                f"{base_url.rstrip('/')}/{version}/{platform}/"
                f"{name}.duckdb_extension.gz"
            )
            checksum = hashlib.sha256()
            with urllib.request.urlopen(url) as response:
                while chunk := response.read(1024 * 1024):
                    checksum.update(chunk)

            sources.append(
                {
                    "type": "file",
                    "url": url,
                    "sha256": checksum.hexdigest(),
                    "dest": "flatpak-node/duckdb-extensions",
                    "dest-filename": (
                        f"{name}-{platform}.duckdb_extension.gz"
                    ),
                    "only-arches": ["x86_64"],
                }
            )

    return sources


def sync_generated_sources(
    lockfile: Path,
    output: Path,
    hash_file: Path,
    force: bool = False,
) -> bool:
    root = repo_root()
    if not lockfile.is_absolute():
        lockfile = root / lockfile
    if not output.is_absolute():
        output = root / output
    if not hash_file.is_absolute():
        hash_file = root / hash_file

    source_hash, lockfile = compute_sources_hash(lockfile=lockfile)
    stored_hash = read_sources_stored_hash(hash_file)

    if not force and output.exists() and stored_hash == source_hash:
        print("Flatpak generated sources are up to date (hash match).")
        return False

    if force:
        print("Regenerating flatpak sources (forced by --force).")
    elif not output.exists():
        print(f"Regenerating flatpak sources (missing output: {output}).")
    elif stored_hash is None:
        print(f"Regenerating flatpak sources (missing hash file: {hash_file}).")
    else:
        print("Regenerating flatpak sources (lockfile hash changed).")

    generate_sources(
        lockfile=lockfile,
        output=output,
    )
    write_sources_stored_hash(hash_file=hash_file, value=source_hash)
    print(f"Updated Flatpak sources hash: {hash_file}")
    return True


def _resolve_paths(paths: Iterable[Path], root: Path) -> List[Path]:
    resolved: List[Path] = []
    for path in paths:
        resolved.append(path if path.is_absolute() else root / path)
    return resolved


def _discover_nuget_projects(search_root: Path) -> List[Path]:
    projects = [
        path
        for path in collect_nuget_input_files(search_root=search_root)
        if path.suffix.lower() == ".csproj"
    ]
    if not projects:
        raise FileNotFoundError(f"No .csproj files found under: {search_root}")
    return projects


def generate_nuget_sources(
    projects: List[Path],
    output: Path,
    dotnet: str,
    freedesktop: str,
    destdir: str,
    runtime: str,
) -> None:
    info = ensure_venv(install_packages=True)
    root = repo_root()

    ensure_flathub_remote()
    ensure_flatpak_ref(f"org.freedesktop.Sdk//{freedesktop}")
    ensure_flatpak_ref(f"org.freedesktop.Sdk.Extension.dotnet{dotnet}//{freedesktop}")

    with tempfile.TemporaryDirectory(prefix="flatpak-nuget-restore-") as temp_dir:
        temp_path = Path(temp_dir)
        obj_dir = temp_path / "obj"
        for project in projects:
            run_command(
                [
                    "flatpak",
                    "run",
                    "--env=DOTNET_CLI_TELEMETRY_OPTOUT=true",
                    "--env=DOTNET_SKIP_FIRST_TIME_EXPERIENCE=true",
                    "--command=sh",
                    f"--runtime=org.freedesktop.Sdk//{freedesktop}",
                    "--share=network",
                    "--filesystem=host",
                    f"org.freedesktop.Sdk.Extension.dotnet{dotnet}//{freedesktop}",
                    "-c",
                    (
                        f'PATH="${{PATH}}:/usr/lib/sdk/dotnet{dotnet}/bin" '
                        f'LD_LIBRARY_PATH="$LD_LIBRARY_PATH:/usr/lib/sdk/dotnet{dotnet}/lib" '
                        'exec dotnet restore "$@"'
                    ),
                    "--",
                    "--packages",
                    str(temp_path / "packages"),
                    str(project),
                    "--runtime",
                    runtime,
                    f"-p:BaseIntermediateOutputPath={obj_dir}/",
                    f"-p:MSBuildProjectExtensionsPath={obj_dir}/",
                ],
                cwd=root,
            )

    cmd = [
        str(info.python_exe),
        str(info.flatpak_dotnet_generator),
        "--dotnet",
        dotnet,
        "--freedesktop",
        freedesktop,
        "--destdir",
        destdir,
        str(output),
        *[str(project) for project in projects],
        "--runtime",
        runtime,
    ]

    run_command(cmd, cwd=root)


def sync_generated_nuget_sources(
    search_root: Path,
    projects: Optional[List[Path]],
    output: Path,
    hash_file: Path,
    dotnet: str,
    freedesktop: str,
    destdir: str,
    runtime: str,
    force: bool = False,
) -> bool:
    root = repo_root()
    if not search_root.is_absolute():
        search_root = root / search_root
    if not output.is_absolute():
        output = root / output
    if not hash_file.is_absolute():
        hash_file = root / hash_file

    if projects:
        projects = _resolve_paths(projects, root)
    else:
        projects = _discover_nuget_projects(search_root)

    for project in projects:
        if not project.exists():
            raise FileNotFoundError(f"NuGet project not found: {project}")

    source_hash, _ = compute_nuget_sources_hash(search_root=search_root)
    stored_hash = read_nuget_stored_hash(hash_file)

    if not force and output.exists() and stored_hash == source_hash:
        print("Flatpak NuGet sources are up to date (hash match).")
        return False

    if force:
        print("Regenerating Flatpak NuGet sources (forced by --force).")
    elif not output.exists():
        print(f"Regenerating Flatpak NuGet sources (missing output: {output}).")
    elif stored_hash is None:
        print(f"Regenerating Flatpak NuGet sources (missing hash file: {hash_file}).")
    else:
        print("Regenerating Flatpak NuGet sources (project hash changed).")

    generate_nuget_sources(
        projects=projects,
        output=output,
        dotnet=dotnet,
        freedesktop=freedesktop,
        destdir=destdir,
        runtime=runtime,
    )
    write_nuget_stored_hash(hash_file=hash_file, value=source_hash)
    print(f"Updated Flatpak NuGet sources hash: {hash_file}")
    return True


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Generate Flatpak source manifests. "
            "By default this updates both generated-sources.json and "
            "generated-nuget-sources.json."
        )
    )

    parser.add_argument(
        "--only",
        choices=("all", "pnpm", "nuget"),
        default="all",
        help="Select which source types to sync (default: all)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Always regenerate selected source files, even when hashes match",
    )

    nuget_group = parser.add_argument_group("nuget options")
    nuget_group.add_argument(
        "--search-root",
        default=DEFAULT_NUGET_SEARCH_ROOT,
        help="Root directory to scan for NuGet dependency changes (default: extensions)",
    )
    nuget_group.add_argument(
        "--project",
        action="append",
        default=[],
        help=(
            "Project file path (repeat for multiple projects). "
            "If omitted, all .csproj files under --search-root are used"
        ),
    )

    return parser


def main() -> None:
    args = _build_parser().parse_args()

    run_pnpm = args.only in {"all", "pnpm"}
    run_nuget = args.only in {"all", "nuget"}

    if run_pnpm:
        sync_generated_sources(
            lockfile=Path(DEFAULT_LOCKFILE),
            output=Path(DEFAULT_PNPM_OUTPUT),
            hash_file=Path(DEFAULT_PNPM_HASH_FILE),
            force=args.force,
        )

    if run_nuget:
        projects = [Path(project) for project in args.project] if args.project else None

        sync_generated_nuget_sources(
            search_root=Path(args.search_root),
            projects=projects,
            output=Path(DEFAULT_NUGET_OUTPUT),
            hash_file=Path(DEFAULT_NUGET_HASH_FILE),
            dotnet=DEFAULT_DOTNET,
            freedesktop=DEFAULT_FREEDESKTOP,
            destdir=DEFAULT_DESTDIR,
            runtime=DEFAULT_RUNTIME,
            force=args.force,
        )


if __name__ == "__main__":
    main()
