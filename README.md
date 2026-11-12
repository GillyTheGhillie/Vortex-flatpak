<p align="center">
  <img src=".github/assets/github_readme_title.png" alt="Vortex Mod Manager title banner"/>
</p>

<p align="center">  
<a href="https://discord.gg/nexusmods"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
<a href="https://twitter.com/nexussites"><img src="https://img.shields.io/badge/twitter-000000?style=for-the-badge&logo=x&logoColor=white" alt="X (formally Twitter)"></a>
<a href="https://www.youtube.com/c/NexusModsYT"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
<a href="https://www.instagram.com/nexusmodsofficial/"><img src="https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram"></a>
<a href="https://www.reddit.com/r/nexusmods/"><img src="https://img.shields.io/badge/Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white" alt="Reddit"></a>
<a href="https://www.facebook.com/nexussites/"><img src="https://img.shields.io/badge/Facebook-1877F2?style=for-the-badge&logo=facebook&logoColor=white" alt="Facebook"></a>
</p>

## Introduction

Vortex is the current mod manager from Nexus Mods. It is designed to make modding your game as simple as possible for new users, while still providing enough control for more experienced veterans of the modding scene.

Our approach with Vortex aims to take complex tasks such as sorting your load order or managing your mod files and automate as much of the process as possible with the goal of having you achieve a stable modded game with minimal effort. We want to help you spend less time modding and more time playing your games.

## About This Fork

This repository is a community modification of [Nexus Mods Vortex](https://github.com/Nexus-Mods/Vortex), maintained by [GillyTheGhillie](https://github.com/GillyTheGhillie). It adds and maintains Flatpak packaging and related build tooling; it is not an official Nexus Mods release.

The original project is licensed under the [GNU General Public License v3.0](LICENSE.md). That license permits modification and redistribution subject to its terms. Please retain the original copyright and license notices and provide the corresponding source when redistributing. Vortex and its original code are credited to Nexus Mods and the upstream contributors; this fork's changes are maintained by GillyTheGhillie.

## Features

- **Multi-game Support** - with mod support for over 250 different games and counting, Vortex is the most versatile mod manager available. This includes games such as [Skyrim](https://www.nexusmods.com/skyrimspecialedition), [Fallout 3](https://www.nexusmods.com/fallout3), [Fallout 4](https://www.nexusmods.com/fallout4), [Fallout: New Vegas](https://www.nexusmods.com/newvegas/), [Cyberpunk 2077](https://www.nexusmods.com/cyberpunk2077/), [Baldur's Gate 3](https://www.nexusmods.com/baldursgate3/), [Starfield](https://www.nexusmods.com/starfield/), [Stardew Valley](https://www.nexusmods.com/stardewvalley/), [Bannerlord](https://www.nexusmods.com/mountandblade2bannerlord), [Witcher 3](https://www.nexusmods.com/witcher3), [Elden Ring](https://www.nexusmods.com/eldenring), [The Sims 4](https://www.nexusmods.com/thesims4), [Monster Hunter: World](https://www.nexusmods.com/monsterhunterworld), [Oblivion](https://www.nexusmods.com/oblivion), [Palworld](https://www.nexusmods.com/palworld), [Blade & Sorcery](https://www.nexusmods.com/bladeandsorcery), [Valheim](https://www.nexusmods.com/valheim), [Hogwarts Legacy](https://www.nexusmods.com/hogwartslegacy/), [7 Days to Die](https://www.nexusmods.com/7daystodie/).

- **Close integration with Nexus Mods** - Vortex is designed to seamlessly interact with Nexus Mods, allowing you to easily find, install, and play mods from our site, learn about new files and catch the latest news.

- **Modding made easy** - The built-in auto-sorting system manages your load order and helps you to resolve mod conflicts with powerful, yet easy to use plugin management features.

- **Mod Profiles** - Easily set up, switch between, and manage independent mod profiles, enabling you to use exactly the combination of mods that you want for a particular playthrough.

- **Modern, Easy-to-use UI** - Featuring a fully customisable interface, Vortex allows you to quickly and easily access tools and manage your games, plugins, downloads and save games.

- **Extensions and Plugins** - Vortex is released under a GPL-3.0 License, giving our community the ability to write extensions and frameworks which can then interact with Vortex, continually adding to its functionality.

## Getting Started

To get started, Vortex can be downloaded from [Nexus Mods](https://www.nexusmods.com/site/mods/1?tab=files) or from [GitHub](https://github.com/Nexus-Mods/Vortex/releases/latest). After the installer has been downloaded, just run it and follow the instructions.

Additional information on Vortex and guides can be found in the [Vortex Wiki](https://github.com/Nexus-Mods/Vortex/wiki).

## Build and Install the Flatpak

The Flatpak can be built inside a Podman or Docker container so the build's Flatpak remotes, SDKs, and caches are isolated from the host's normal Flatpak installation. The commands below clone this fork, build the bundle, and then install it on the host only when you run the final command.

Clone the repository and initialize its submodules:

```bash
git clone https://github.com/GillyTheGhillie/Vortex-flatpak.git
cd Vortex-flatpak
git submodule update --init --recursive
```

### Podman

```bash
podman build -f flatpak/Containerfile -t vortex-flatpak-builder .
mkdir -p "$HOME/.cache/vortex-flatpak-builder"

podman run --rm --privileged --userns=keep-id \
  --user "$(id -u):$(id -g)" \
  --security-opt label=disable \
  -v "$PWD:/workspace" \
  -v "$HOME/.cache/vortex-flatpak-builder:/flatpak-cache" \
  -e HOME=/tmp \
  -e XDG_DATA_HOME=/flatpak-cache/data \
  -e XDG_CACHE_HOME=/flatpak-cache/cache \
  -w /workspace vortex-flatpak-builder \
  sh -eu -c 'python3 flatpak/scripts/flatpak_build.py --disable-rofiles-fuse &&
    flatpak build-export --update-appstream flatpak/flatpak-repo build-flatpak &&
    flatpak build-bundle flatpak/flatpak-repo build-flatpak/com.nexusmods.vortex.flatpak com.nexusmods.vortex'
```

### Docker

```bash
docker build -f flatpak/Containerfile -t vortex-flatpak-builder .
mkdir -p "$HOME/.cache/vortex-flatpak-builder"

docker run --rm --privileged \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" \
  -v "$HOME/.cache/vortex-flatpak-builder:/flatpak-cache" \
  -e HOME=/tmp \
  -e XDG_DATA_HOME=/flatpak-cache/data \
  -e XDG_CACHE_HOME=/flatpak-cache/cache \
  -w /workspace vortex-flatpak-builder \
  sh -eu -c 'python3 flatpak/scripts/flatpak_build.py --disable-rofiles-fuse &&
    flatpak build-export --update-appstream flatpak/flatpak-repo build-flatpak &&
    flatpak build-bundle flatpak/flatpak-repo build-flatpak/com.nexusmods.vortex.flatpak com.nexusmods.vortex'
```

The bundle is created at `build-flatpak/com.nexusmods.vortex.flatpak`. To install it into your user Flatpak installation, run this command from the repository root on the host:

```bash
flatpak install --user --bundle ./build-flatpak/com.nexusmods.vortex.flatpak
```

Installation may download the required Flatpak runtime from a configured remote. Building does not install Vortex on the host.

## Resources

- [Download Vortex](https://www.nexusmods.com/site/mods/1?tab=files) from Nexus Mods
- [GitHub](https://github.com/Nexus-Mods/Vortex) for source code, issues, and pull requests.
- [Vortex Forum](https://forums.nexusmods.com/index.php?/forum/4306-vortex-support/) or [Discord](https://discord.gg/nexusmods) for support and discussions with the community and the team.
- [Vortex Wiki](https://github.com/Nexus-Mods/Vortex/wiki) for knowledge base, articles and troubleshooting

## Contributing

The majority of Vortex code is open-source. We are committed to a transparent development process and highly appreciate any contributions. Whether you are helping us fix bugs, proposing new features, improving our documentation or spreading the word - we would love to have you as a part of the Vortex community.

- Bug Report: If you see an error message or encounter an issue while using our application, please create a [bug report](https://github.com/Nexus-Mods/Vortex/issues/new?assignees=&labels=&projects=&template=bug_report.md&title=).
- Feature Request: If you have an idea or if there is a capability that is missing and would make development easier and more robust, please submit a [feature request](https://github.com/Nexus-Mods/Vortex/issues/new?assignees=&labels=&projects=&template=feature_request.md&title=).
- Pull Request: Read [CONTRIBUTING.md](CONTRIBUTING.md) first. We are in the middle of large foundational changes and can only take small pull requests at the moment, so check with us before starting anything big.

## Developing

To build and run Vortex from source, start with [CONTRIBUTING.md](./CONTRIBUTING.md). It covers setup for each platform, the build/run/hot-reload workflow, debugging, and packaging. Deeper guides (debugging, packaging, the auto-updater, release process) are indexed in [docs/README.md](./docs/README.md).

## License

This project is licensed under the [GPL-3.0](https://github.com/Nexus-Mods/Vortex/blob/master/LICENSE.md) license.
