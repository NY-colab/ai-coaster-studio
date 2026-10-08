$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$appRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
try {
  $serverState = Join-Path $appRoot 'data/server.json'
  if (Test-Path -LiteralPath $serverState) {
    $prior = Get-Content -LiteralPath $serverState -Raw | ConvertFrom-Json
    if ($prior.url -match '^http://127\.0\.0\.1:\d+$') {
      $online = $false
      try { $ping = Invoke-RestMethod ($prior.url + '/api/ping') -TimeoutSec 2; $online = ($ping.app -eq 'coaster-studio') } catch {}
      if ($online) { throw 'Close the mobile event and exit the app from Settings, then run UPDATE.cmd again.' }
    }
  }
  $legacyState = Join-Path $appRoot 'data/share-session.json'
  if (Test-Path -LiteralPath $legacyState) {
    $legacy = Get-Content -LiteralPath $legacyState -Raw | ConvertFrom-Json
    if ($legacy.controlUrl -match '^http://127\.0\.0\.1:\d+$') {
      $legacyOnline = $false
      try { $reply = Invoke-RestMethod ($legacy.controlUrl + '/status') -TimeoutSec 2; $legacyOnline = ($reply.app -eq 'coaster-share') } catch {}
      if ($legacyOnline) { throw 'Stop the old external sharing session first (STOP_SHARE.vbs from the old version).' }
    }
  }
  $release = Invoke-RestMethod 'https://api.github.com/repos/NY-colab/ai-coaster-studio/releases/latest'
  $version = $release.tag_name -replace '^v',''
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
  $current = (Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json).version
  if ([version]$version -le [version]$current) { Write-Host "Already up to date: $current"; exit 0 }
  $package = $release.assets | Where-Object name -eq 'AI-Coaster-Studio-Windows-x64.zip'
  $hashes = $release.assets | Where-Object name -eq 'SHA256SUMS.json'
  if (-not $package -or -not $hashes) { throw 'The release package or checksum file is missing.' }
  $updateRoot = Join-Path $appRoot ('work/update-' + $version + '-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
  $zipPath = Join-Path $updateRoot 'package.zip'
  Invoke-WebRequest $package.browser_download_url -OutFile $zipPath
  $manifest = Invoke-RestMethod $hashes.browser_download_url
  $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifest.portableZip.name -ne $package.name -or $actualHash -ne $manifest.portableZip.sha256) { throw 'Downloaded package checksum does not match.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try { foreach ($entry in $archive.Entries) {
    $entryName = $entry.FullName.Replace('\','/')
    if (-not $entryName.StartsWith('AI-Coaster-Studio/') -or $entryName -match '(^|/)\.\.(/|$)' -or $entryName.Contains(':')) { throw 'Unsafe path in release archive.' }
  }} finally { $archive.Dispose() }
  $extract = Join-Path $updateRoot 'extracted'
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extract
  $newApp = Join-Path $extract 'AI-Coaster-Studio'
  $newVersion = (Get-Content -LiteralPath (Join-Path $newApp 'package.json') -Raw | ConvertFrom-Json).version
  if ($newVersion -ne $version) { throw 'Release version does not match the package.' }
  $parentRoot = [IO.Path]::GetFullPath((Split-Path -Parent $appRoot))
  $destination = [IO.Path]::GetFullPath((Join-Path $parentRoot ('AI-Coaster-Studio-' + $version)))
  if (-not $destination.StartsWith($parentRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe destination path.' }
  if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination. It was not overwritten." }
  # Only copy user artwork. Server locks, event credentials and live state are never migrated.
  foreach ($name in @('photos','jobs','exports')) {
    $original = Join-Path $appRoot ('data/' + $name)
    if (Test-Path -LiteralPath $original) { New-Item -ItemType Directory -Force (Join-Path $newApp 'data') | Out-Null; Copy-Item -LiteralPath $original -Destination (Join-Path $newApp 'data') -Recurse }
  }
  Move-Item -LiteralPath $newApp -Destination $destination
  Write-Host "Update ready: $destination"
  Write-Host 'The previous app folder was kept. Open START.vbs in the new folder.'
} catch { Write-Error $_; exit 1 }
