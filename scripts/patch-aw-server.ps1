param(
  [string]$Path
)

$ErrorActionPreference = "Stop"
$originalSha256 = "eaf7a265ab05d0ffbca6fefced047a95116a9fb8b3d439ea4cc23c5b25e95232"
$patchedSha256 = "444be98e390618742377e8ae1abaaffbee521d27173b9c4f87d58d6733c317aa"

function Get-Sha256Hex {
  param([byte[]]$Bytes)

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

if ([string]::IsNullOrWhiteSpace($Path)) {
  $Path = Join-Path $PSScriptRoot "..\src-tauri\vendor\activitywatch\aw-server-rust.exe"
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
$currentSha256 = Get-Sha256Hex $bytes
if ($currentSha256 -eq $patchedSha256) {
  Write-Host "ActivityWatch is already configured for windowless startup."
  exit 0
}
if ($currentSha256 -ne $originalSha256) {
  throw "Refusing to patch an untrusted ActivityWatch binary: $currentSha256"
}

if ($bytes.Length -lt 256 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
  throw "ActivityWatch is not a valid PE executable."
}

$peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
if ($peOffset -lt 0 -or $peOffset + 94 -gt $bytes.Length) {
  throw "ActivityWatch has an invalid PE header offset."
}
if ([BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x00004550) {
  throw "ActivityWatch does not have a valid PE signature."
}

$optionalHeaderOffset = $peOffset + 24
$optionalHeaderMagic = [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset)
if ($optionalHeaderMagic -notin @(0x010B, 0x020B)) {
  throw "ActivityWatch has an unsupported PE optional header."
}

$subsystemOffset = $optionalHeaderOffset + 68
$subsystem = [BitConverter]::ToUInt16($bytes, $subsystemOffset)
if ($subsystem -ne 3) {
  throw "ActivityWatch PE subsystem is not Windows CUI: $subsystem"
}

$bytes[$subsystemOffset] = 2
$bytes[$subsystemOffset + 1] = 0
$patchedBytesSha256 = Get-Sha256Hex $bytes
if ($patchedBytesSha256 -ne $patchedSha256) {
  throw "Patched ActivityWatch hash verification failed: $patchedBytesSha256"
}

[System.IO.File]::WriteAllBytes($resolvedPath, $bytes)
Write-Host "ActivityWatch is configured for windowless startup."
