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
# install the tool once
winget install Microsoft.WingetCreate

# submit the manifest folder (uses the SHA256 already embedded in the installer yaml)
wingetcreate submit packaging/winget
```

**Option B — manual PR:**

1. Fork `microsoft/winget-pkgs`.
2. Copy this folder to `manifests/k/kinghackers/Dockyard/0.2.2/` in your fork.
3. Open a PR against `master`.
4. The CI (Windows Package Manager Validation) must pass before merge.

## Updating for a new release

Bump `PackageVersion` in all four files, update the installer `InstallerUrl`
(keep the `releases/download/vX.Y.Z/...` pattern), and replace
`InstallerSha256` with the new artifact's SHA-256.
