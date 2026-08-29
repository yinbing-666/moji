param(
  [string]$Installer
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$packageLockPath = Join-Path $repoRoot 'package-lock.json'
$packageLockVersionsJson = & node -e "const fs = require('fs'); const lock = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(JSON.stringify({ version: lock.version, rootVersion: lock.packages[''].version }));" $packageLockPath
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to read package versions from package-lock.json'
}
$packageLockVersions = $packageLockVersionsJson | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$cargoToml = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\Cargo.toml') -Raw
$cargoLock = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\Cargo.lock') -Raw
$cargoMatch = [regex]::Match($cargoToml, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')
$cargoLockMatch = [regex]::Match($cargoLock, '(?ms)^name\s*=\s*"moji-daily"\s*\r?\nversion\s*=\s*"([^"]+)"')

if (-not $cargoMatch.Success -or -not $cargoLockMatch.Success) {
  throw 'Unable to read package versions from Cargo.toml or Cargo.lock'
}

$versions = [ordered]@{
  'package.json' = [string]$packageJson.version
  'package-lock.json' = [string]$packageLockVersions.version
  'package-lock root package' = [string]$packageLockVersions.rootVersion
  'src-tauri/Cargo.toml' = $cargoMatch.Groups[1].Value
  'src-tauri/Cargo.lock' = $cargoLockMatch.Groups[1].Value
  'src-tauri/tauri.conf.json' = [string]$tauriConfig.version
}

$versions.GetEnumerator() | ForEach-Object { Write-Output ("{0}: {1}" -f $_.Key, $_.Value) }
$uniqueVersions = @($versions.Values | Select-Object -Unique)
if ($uniqueVersions.Count -ne 1) {
  throw "Release versions do not match: $($uniqueVersions -join ', ')"
}

Write-Output "Version check passed: $($uniqueVersions[0])"

if ($Installer) {
  $resolvedInstaller = (Resolve-Path -LiteralPath $Installer).Path
  $hash = Get-FileHash -LiteralPath $resolvedInstaller -Algorithm SHA256
  Write-Output "Installer: $resolvedInstaller"
  Write-Output "SHA256: $($hash.Hash.ToLowerInvariant())"
}
