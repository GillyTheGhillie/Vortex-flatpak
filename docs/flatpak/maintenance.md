# Flatpak Maintenance

How to build and update the Flatpak package.

> [!IMPORTANT]
>
> ## pnpm lockfiles are supported
>
> [flatpak-builder-tools PR 511] added pnpm lockfile support and was merged on
> March 12, 2026, completing [upstream issue 383]. Upstream subsequently added
> [pnpm v11] and [pnpm v12] store support. Vortex now generates its offline
> dependency sources from `pnpm-lock.yaml` using the pnpm v11 store format.
>
> The build uses the Node 24 SDK extension's runtime rather than downloading a
> Node binary. It explicitly prepares the FOMOD native dependency before
> Electron's Linux native-module rebuild because the generated offline store
> does not run that package's install hook.

> [!NOTE]
> **Prerequisites:** see [Flatpak packaging] for the basics and
> first-time setup.

## Helper Scripts

Scripts in `flatpak/scripts/` automate common tasks. They manage their own
virtual environment and can run from any directory.

> [!TIP]
> Use `python` instead if `python3` does not work on your system.

### Development Workflow

- `flatpak_build.py`: build the Flatpak with standard defaults
- `flatpak_run.py`: run the installed Flatpak, building and installing first
  if needed

### Distribution And UX Testing Workflow

- `flatpak_install.py`: export to a local repo and install the app so it
  appears in KDE Discover and similar software centers
- `flatpak_bundle.py`: export to a local repo and create a `.flatpak` bundle

## Typical Workflows

### First-time Setup

Initialize submodules if the checkout uses them:

```bash
git submodule update --init --recursive
```

### Isolated Podman Build

The container workflow keeps Flatpak remotes, SDKs, and build caches out of the
desktop Flatpak installation. Rootless Podman needs `--privileged` to permit
the nested `bwrap` sandbox used by Flatpak Builder; the container only mounts
the repository and a dedicated cache directory.

```bash
podman build -f flatpak/Containerfile -t vortex-flatpak-builder .
mkdir -p "$HOME/.cache/vortex-flatpak-builder"
podman run --rm --privileged --userns=keep-id --user "$(id -u):$(id -g)" \
  --security-opt label=disable \
  -v "$PWD:/workspace" \
  -v "$HOME/.cache/vortex-flatpak-builder:/flatpak-cache" \
  -e HOME=/tmp \
  -e XDG_DATA_HOME=/flatpak-cache/data \
  -e XDG_CACHE_HOME=/flatpak-cache/cache \
  -w /workspace vortex-flatpak-builder \
  python3 flatpak/scripts/flatpak_build.py --disable-rofiles-fuse
```

The dedicated XDG paths are important: omitting them can use Flatpak remotes
and runtimes from the host installation.

### Development Iteration

**Quick test (fastest, no install):**

```bash
python3 flatpak/scripts/flatpak_build.py
python3 flatpak/scripts/flatpak_run.py
```

**UX testing (appears in Discover, GNOME Software):**

Builds and installs the app (it will appear in software centers like KDE Discover):

```bash
python3 flatpak/scripts/flatpak_install.py
# Optionally run immediately: python3 flatpak/scripts/flatpak_install.py --run
```

If you already built with `flatpak_build.py`, use `--skip-build` to avoid rebuilding:

```bash
python3 flatpak/scripts/flatpak_install.py --skip-build
```

### Creating a Bundle

Builds and creates a `.flatpak` bundle file for publishing:

```bash
python3 flatpak/scripts/flatpak_bundle.py
```

If you already built with `flatpak_build.py`, use `--skip-build` to avoid rebuilding:

```bash
python3 flatpak/scripts/flatpak_bundle.py --skip-build
```

### Workflow Notes

- `flatpak_run.py` ensures the app is installed, then runs it
- `flatpak_install.py --skip-build` re-exports from an existing build without
  rebuilding
- `flatpak_bundle.py` creates a `.flatpak` file for distribution
- `nxm://` protocol switching should work out of the box. Whichever Vortex
  build you launched last should become the active handler

## Script Differences

- **`flatpak_run.py`**: development testing with proper single-instance
  support. It installs the app if needed so protocol handlers work correctly,
  then runs the installed version
- **`flatpak_install.py`**: UX testing. It installs the app properly so it
  appears in software centers and creates a local OSTree repo at
  `flatpak/flatpak-repo/` which is gitignored

## Runtime Updates

Update `runtime-version`, `base-version`, and SDK extensions together to maintain ABI compatibility.

Current baselines:

- Runtime: `org.freedesktop.Platform` 25.08
- BaseApp: `org.electronjs.Electron2.BaseApp` 25.08
- Node SDK: `org.freedesktop.Sdk.Extension.node24`
- .NET SDK: `org.freedesktop.Sdk.Extension.dotnet9`

## generated-sources.json, generated-nuget-sources.json & Offline Build Behaviour

Flatpak builds run in offline mode inside the build sandbox.

- `flatpak-builder` downloads sources up front:
    - pnpm packages in `flatpak/generated-sources.json`
    - NuGet packages in `flatpak/generated-nuget-sources.json`
- build commands then run offline in the sandbox using those prefetched sources

This is required for _Flathub submission_ and ensures reproducible builds.

To keep source files in sync automatically, build scripts now:

- hash `pnpm-lock.yaml` and compare against
  `flatpak/generated-sources.hash`
- hash .NET project files and NuGet inputs under `tools/dotnetprobe` and
  compare against
  `flatpak/generated-nuget-sources.hash`
- regenerate each generated source file only when needed

To sync both generated source files manually, run:

```bash
python3 flatpak/scripts/flatpak_sources.py
```

If you are debugging `generated-sources.json` generation, run:

```bash
python3 flatpak/scripts/flatpak_sources.py --only pnpm --force
```

If you are debugging `generated-nuget-sources.json` generation, run:

```bash
python3 flatpak/scripts/flatpak_sources.py --only nuget --force
```

NuGet source syncing scans `tools/dotnetprobe/` by default. It installs the
matching Flatpak SDK and .NET SDK extension into the current user's Flatpak
installation before restoring projects. Use `--search-root` to narrow the
scope during debugging.

## Troubleshooting

- pnpm reports that it cannot download Node during the offline install: the
  manifest must use the Node 24 SDK extension matching the `24.22.2` runtime
  required by the workspace.
- FOMOD native build fails because `ModInstaller.Native.so` is missing: the
  Flatpak build explicitly runs the package install hook before rebuilding
  Linux Electron modules. Keep this step when changing the pnpm source
  generator.
- `nxm://` handler did not switch automatically:

```bash
# Check current handler on host
xdg-settings get default-url-scheme-handler nxm

# Force Flatpak build as handler
xdg-settings set default-url-scheme-handler nxm com.nexusmods.vortex.desktop

# Force development build as handler
xdg-settings set default-url-scheme-handler nxm com.nexusmods.vortex.dev.desktop
```

## References

- [Flatpak Electron guide]
- [Flatpak .NET guide]
- [flatpak-builder documentation]

[Flatpak packaging]: ../packaging/flatpak.md
[upstream issue 383]: https://github.com/flatpak/flatpak-builder-tools/issues/383
[Flatpak Builder Tools PR 511]: https://github.com/flatpak/flatpak-builder-tools/pull/511
[pnpm v11]: https://github.com/flatpak/flatpak-builder-tools/commit/ee65dc7a798be56de8c4c1ab73411461cac020b4
[pnpm v12]: https://github.com/flatpak/flatpak-builder-tools/commit/74697c75b630d7330e77250fc13cb5ea688d9479
[Flatpak .NET guide]: https://docs.flatpak.org/en/latest/dotnet.html
[Flatpak Electron guide]: https://docs.flatpak.org/en/latest/electron.html
[flatpak-builder documentation]: https://docs.flatpak.org/en/latest/flatpak-builder.html
