# Builds the plugin zip. Compress-Archive writes backslash entry paths, which the
# Teams app package validator rejects, so entries are added by hand with forward slashes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$zipPath = Join-Path $root 'smartsheet-cowork-plugin.zip'
$files = @(
  'manifest.json',
  'color.png',
  'outline.png'
)

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($file in $files) {
    $source = Join-Path $root ($file -replace '/', '\')
    if (-not (Test-Path $source)) { throw "Missing file: $file" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $file) | Out-Null
  }
}
finally {
  $zip.Dispose()
}

Write-Output "Wrote $zipPath"
foreach ($f in $files) { Write-Output "  $f" }
