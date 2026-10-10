# Dockyard

> An open-source, multi-host Docker manager built with Electron + React.

[![CI](https://github.com/kinghackers/dockyard/actions/workflows/ci.yml/badge.svg)](https://github.com/kinghackers/dockyard/actions/workflows/ci.yml)
[![Release](https://github.com/kinghackers/dockyard/actions/workflows/release.yml/badge.svg)](https://github.com/kinghackers/dockyard/actions/workflows/release.yml)

- Primary repo (Gitee): <https://gitee.com/kinghackers/dockyard>
- GitHub mirror: <https://github.com/kinghackers/dockyard>

[Features](#features) · [Quick Start](#quick-start) · [Connection Modes](#connection-modes) · [Development](#development) · [License](#license)

---

## Features

- **Unified multi-host management**: view containers, images, volumes, networks and Compose projects across many hosts in one place.
- **Multiple connection modes**: TCP (optional TLS), SSH tunnel, or the local Docker socket.
- **Full container lifecycle**: start / stop / restart / remove / rename, terminal, logs (filter & regex), file browser (upload / download).
- **Image operations**: pull, import from tar, tag, push, layer history, prune.
- **Polished lists**: relative timestamps (exact time on hover), filter match count, one-click clear, right-aligned numeric columns, ellipsis for long text.
- **Internationalized**: Simplified Chinese / Traditional Chinese / English.

## Screenshots

| Screen | Description |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | Multi-host overview and resource stats |
| ![Containers](docs/screenshots/containers.png) | Container list, filtering and bulk actions |
| ![Connection](docs/screenshots/connection.png) | Add / edit Docker connection (TCP / SSH / socket) |
| ![Terminal & Logs](docs/screenshots/terminal-logs.png) | Container terminal and logs |
| ![Settings](docs/screenshots/settings.png) | Preferences and about |

> Drop screenshots into `docs/screenshots/` (PNG, ~1280×800). Placeholder for now — real images to be added.

## Quick Start

### Download a release

Go to [GitHub Releases](https://github.com/kinghackers/dockyard/releases) (or [Gitee Releases](https://gitee.com/kinghackers/dockyard/releases)) and download the Windows installer (`Dockyard-x.y.z-Setup.exe`).

### Build from source

```bash
# Primary repo (Gitee)
git clone https://gitee.com/kinghackers/dockyard.git dockyard
# Or use the GitHub mirror
git clone https://github.com/kinghackers/dockyard.git dockyard
cd dockyard
npm ci
npm run dev      # Launch dev window (Vite + Electron)
npm run dist     # Package the Windows NSIS installer (pushing a v* tag to GitHub triggers the automated release)
```

> If `npm run dist` fails on Windows (e.g. `app.asar` locked), use `npm run dist:compat`.

## Connection Modes

| Mode | Description |
| --- | --- |
| TCP | Plain or TLS-encrypted TCP to the daemon port. |
| SSH tunnel | Tunnel through SSH; credentials are encrypted at rest locally. |
| Local socket | The local Docker socket (Windows named pipe / Linux, macOS Unix socket). |

## Tech stack

- **Electron** + **React 18** + **Vite 5** + **TypeScript**
- **dockerode** — Docker Engine API client
- **ssh2** — SSH tunnel
- **zustand** — state management
- **lucide-react** — icons
- **OpenCC** — Simplified → Traditional Chinese conversion
- **vitest** — unit / smoke tests

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md). App source lives in `src/`, the Electron main process in `electron/`, and build scripts at the repo root. Common commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Launch dev (Vite + Electron) |
| `npm run test` | Unit tests (vitest) |
| `npm run e2e` | Smoke test against a mock daemon |
| `npm run verify` | Full verify (typecheck + tests + IPC/logic + e2e) |

## Security

Connection credentials are stored encrypted on the local machine; exports can strip secrets. See [SECURITY.md](./SECURITY.md).

## Roadmap

- Multi-platform release: the Windows release workflow is in place (GitHub Releases, see `.github/workflows/release.yml`); macOS / Linux installers and their signing/notarization are pending
- Code signing for installers
- Live per-container metrics charts
- Broader registry integrations

## License

Released under the [MIT License](./LICENSE).

## Trademark

"Docker" is a trademark of Docker, Inc. This project is not affiliated with or endorsed by Docker, Inc.
