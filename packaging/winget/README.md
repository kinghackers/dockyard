# Winget manifest — `kinghackers.Dockyard`

These files are the winget package manifest for Dockyard. They live in this repo
so they can be versioned alongside the code; the authoritative copy must be
submitted to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).

> Note: this only smooths the **SmartScreen** path (a shorter, well-known install
> command). It does **not** bypass **Smart App Control** — an unsigned package is
> still hard-blocked by SAC. See the repository README for the full picture.

## Submit to winget-pkgs

**Option A — `wingetcreate` (recommended, auto-validates and opens the PR):**

```powershell
# install the tool once (if the msstore source errors out, add --source winget)
winget install Microsoft.WingetCreate --source winget

# submit the manifest folder (uses the SHA256 already embedded in the installer yaml)
wingetcreate submit packaging/winget
```

> **GitHub API rate limit**: the first `wingetcreate` run is anonymous and hits the
> low GitHub rate limit. Store a token once with `wingetcreate token --store`
> (paste a classic PAT with the **`public_repo`** scope), or pass it inline:
> `wingetcreate submit packaging/winget -t <PAT>`. The token is only used to fork
> `microsoft/winget-pkgs` and open the PR; delete it after the PR is merged.

**Option B — manual PR:**

1. Fork `microsoft/winget-pkgs`.
2. Copy this folder to `manifests/k/kinghackers/Dockyard/0.2.2/` in your fork.
3. Open a PR against `master`.
4. The CI (Windows Package Manager Validation) must pass before merge.

## Updating for a new release

Bump `PackageVersion` in all four files, update the installer `InstallerUrl`
(keep the `releases/download/vX.Y.Z/...` pattern), and replace
`InstallerSha256` with the new artifact's SHA-256.

## Troubleshooting

- **`msstore` source errors** (`0x80072efd` / "failed to update source msstore"):
  irrelevant to this flow. Run `winget install Microsoft.WingetCreate --source winget`,
  and if `wingetcreate` itself complains later, `winget source remove msstore`
  (the manifest submission only uses the `winget` source).
- **GitHub API rate limit**: store a token via `wingetcreate token --store`
  (classic PAT, `public_repo` scope) or pass `-t <PAT>`.
