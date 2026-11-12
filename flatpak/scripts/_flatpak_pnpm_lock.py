#!/usr/bin/env python3
"""Prepare a pnpm lockfile for flatpak-node-generator."""

import argparse
from pathlib import Path

import yaml


def prepare_lockfile(source: Path, destination: Path) -> None:
    with source.open(encoding="utf-8") as file:
        documents = list(yaml.safe_load_all(file))

    if not documents:
        raise ValueError(f"{source}: lockfile is empty")

    package_manager_metadata = documents[0]
    lockfile = documents[-1]
    importers = lockfile.get("importers", {})
    packages = lockfile.get("packages", {})
    snapshots = lockfile.get("snapshots", {})

    package_manager_dependencies = package_manager_metadata.get("importers", {}).get(
        ".", {}
    ).get("packageManagerDependencies", {})
    pnpm_version = package_manager_dependencies.get("pnpm", {}).get("version")
    pnpm_package = package_manager_metadata.get("packages", {}).get(
        f"pnpm@{pnpm_version}"
    )
    if pnpm_package is None:
        raise ValueError(f"{source}: pnpm CLI package is missing from lock metadata")
    packages[f"pnpm@{pnpm_version}"] = pnpm_package

    runtime_packages = {key for key in packages if "@runtime:" in key}
    for importer in importers.values():
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            dependencies = importer.get(section, {})
            for name, dependency in list(dependencies.items()):
                if isinstance(dependency, dict) and str(
                    dependency.get("version", "")
                ).startswith("runtime:"):
                    del dependencies[name]

    for key in runtime_packages:
        packages.pop(key, None)
        snapshots.pop(key, None)

    destination.write_text(
        yaml.safe_dump(lockfile, sort_keys=False, explicit_start=True),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove non-registry runtime entries for source generation."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    prepare_lockfile(args.source, args.destination)


if __name__ == "__main__":
    main()
