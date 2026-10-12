# Dockyard one-line installer for Windows
# Usage: irm https://raw.githubusercontent.com/kinghackers/dockyard/master/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo    = 'kinghackers/dockyard'
$Pattern = 'Dockyard-*-Setup.exe'

Write-Host 'Fetching latest Dockyard release...' -ForegroundColor Cyan
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
    -Headers @{ 'User-Agent' = 'dockyard-installer' }

$asset = $release.assets | Where-Object { $_.name -like $Pattern } | Select-Object -First 1
if (-not $asset) {
    Write-Error "Could not find a $Pattern asset in the latest release."
    exit 1
}

$tempDir = Join-Path $env:TEMP 'dockyard-install'
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$dest = Join-Path $tempDir $asset.name

Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest

# Clear Mark-of-the-Web so SmartScreen's "downloaded from the internet" prompt does not re-trigger
Unblock-File -Path $dest -ErrorAction SilentlyContinue

# Heads-up for Smart App Control (SAC): it cannot be bypassed for unsigned apps.
# If SAC is On, the installer below is hard-blocked with no "Run anyway" button.
try {
    $sac = (Get-MpComputerStatus).SmartAppControlState
    if ($sac -eq 'On') {
        Write-Host ''
        Write-Warning ("Smart App Control is ON and will hard-block this unsigned installer.`n" +
                       "Temporarily turn it off: Windows Security > App & browser control > Smart App Control > Off,`n" +
                       "then after installing, turn it back On (reversible since the April 2026 update).")
    }
} catch {
    # Get-MpComputerStatus may be unavailable on some builds; ignore.
}

Write-Host 'Launching installer...' -ForegroundColor Cyan
Start-Process -FilePath $dest -Wait
