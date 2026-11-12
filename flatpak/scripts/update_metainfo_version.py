#!/usr/bin/env python3
"""Update the metainfo.xml release version and date for each Flatpak build."""

import re
from datetime import datetime
from pathlib import Path


def make_flatpak_version(now: datetime) -> str:
    """Build a unique, sortable version such as 2026.11.12.21.58.52-flatpak."""
    return now.strftime("%Y.%m.%d.%H.%M.%S") + "-flatpak"


def update_metainfo_version(repo_root: Path) -> None:
    """Update the version and release date in metainfo.xml using regex."""
    metainfo_path = repo_root / "flatpak" / "com.nexusmods.vortex.metainfo.xml"

    if not metainfo_path.exists():
        print(f"Warning: {metainfo_path} not found")
        return

    now = datetime.now()
    version = make_flatpak_version(now)
    today = now.strftime("%Y-%m-%d")

    with open(metainfo_path, "r") as f:
        content = f.read()

    # Update version in existing release tag
    version_pattern = r'(<release\s+version=")([^"]+)("\s+date=")([^"]+)(")'
    if re.search(version_pattern, content):
        content = re.sub(version_pattern, rf"\g<1>{version}\g<3>{today}\g<5>", content)
        print(f"Updated {metainfo_path} with version {version}")
    else:
        # No release tag found, don't modify
        print(
            f"Warning: No release tag found in {metainfo_path}, skipping version update"
        )

    with open(metainfo_path, "w") as f:
        f.write(content)


def main():
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[1]
    update_metainfo_version(repo_root)


if __name__ == "__main__":
    main()
