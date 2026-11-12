# Flatpak Technical Details

Technical notes for developers working on the Flatpak build.

## Build Pipeline

Offline-first: `flatpak-node-generator` converts `pnpm-lock.yaml` into
`generated-sources.json` so builds need no network. The source generator is
pinned to an upstream revision with pnpm v11 store support.

The source preparation helper handles the lockfile's multi-document metadata,
filters the Node runtime entry provided by the SDK, and includes the
lockfile-pinned pnpm CLI in the generated sources.

Build stages (in the SDK sandbox):

1. Extract the pinned pnpm CLI and use the SDK-provided Node 24 runtime.
2. `pnpm install` -- offline dependency fetch; a build-only lockfile excludes
   the runtime download.
3. Run the FOMOD native install hook and rebuild Linux Electron native modules.
4. Nx build targets compile the workspace; publish the main app into its
   standalone deploy directory.
5. Rebuild deployed native modules for Electron, then use `electron-builder`
   to package the app into `dist/linux-unpacked/`.
6. Copy `dist/linux*-unpacked/` to `/app/main`.
7. `dotnet-runtime` module -- stage the .NET runtime.

See `flatpak/com.nexusmods.vortex.yaml` for per-phase commands and environment variables.

## Testing Approaches

### Quick Development Testing (`flatpak_run.py`)

Builds/installs when needed, then runs the installed app:

```bash
python flatpak/scripts/flatpak_run.py
```

### UX Testing (`flatpak_install.py`)

Exports to a local OSTree repo and installs the app:

```bash
python flatpak/scripts/flatpak_install.py
```

This approach:

1. Exports build to `flatpak/flatpak-repo/` (OSTree repository)
2. Adds the repo as a flatpak remote
3. Installs the app from the repo
4. The app now appears in software centers (KDE Discover, GNOME Software)

Use this to test the actual user installation experience.

## pnpm Offline Sources

The generated manifest contains npm registry archives and the pinned pnpm CLI.
The build uses pnpm's v11 offline store and its lockfile without installing
pnpm or Node from the network. The lockfile itself is not changed by the
build-only runtime adjustment.

## Launch Mechanism

`flatpak/run.sh` launches with `zypak-wrapper /app/main/vortex`.

- Zypak runs Electron inside the sandbox (see [Zypak docs])
- Desktop file points to `run.sh`
- Entrypoint must use Zypak per Flatpak Electron guidance

## Why These Choices

- **Full host filesystem access**: Game installs can be anywhere. Deployment
  uses hardlinks, symlinks, and moves. Portals are not viable because scanning
  and deployment are background operations that cannot wait for user prompts.

- **Offline builds**: Required for Flathub and reproducible builds. All pnpm
  and NuGet dependencies must be in their generated source manifests.

- **Zypak wrapper**: Required by the Electron BaseApp to run Chromium's
  sandbox inside Flatpak's sandbox.

- **.NET runtime staging**: Framework-dependent tools such as `dotnetprobe`
  need `DOTNET_ROOT` pointing to the staged runtime at `/app/lib/dotnet`.

- **Electron builder**: We use `electron-builder` with the `dir` target to
  package the app with the Electron runtime. This creates a complete
  distribution in `dist/linux-unpacked/` that gets copied to `/app/main`.

[Zypak docs]: https://github.com/refi64/zypak
[PR 511]: https://github.com/flatpak/flatpak-builder-tools/pull/511
[pnpm v11]: https://github.com/flatpak/flatpak-builder-tools/commit/ee65dc7a798be56de8c4c1ab73411461cac020b4
[pnpm v12]: https://github.com/flatpak/flatpak-builder-tools/commit/74697c75b630d7330e77250fc13cb5ea688d9479
