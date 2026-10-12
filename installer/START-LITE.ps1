param([string]$InstallRoot = (Join-Path $PSScriptRoot 'app'), [switch]$PrepareOnly, [switch]$PreferBundled)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$installBase = [IO.Path]::GetFullPath($InstallRoot)
$manifestUrl = 'https://github.com/NY-colab/ai-coaster-studio/releases/download/v1.4.0/LITE-MANIFEST.json'
function Find-Codex {
    $candidates = @()
    $command = Get-Command codex.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $npmNative = Join-Path $env:APPDATA 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'
    $candidates += $npmNative
    $candidates += (Join-Path $env:APPDATA 'npm/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')
    $desktopBin = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
    if (Test-Path -LiteralPath $desktopBin -PathType Container) {
        foreach ($directory in (Get-ChildItem -LiteralPath $desktopBin -Directory | Sort-Object LastWriteTime -Descending)) { $candidates += (Join-Path $directory.FullName 'codex.exe') }
    }
    $packages = if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) { Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue }
    foreach ($package in $packages) { $candidates += (Join-Path $package.InstallLocation 'app/resources/codex.exe') }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $info = [Diagnostics.ProcessStartInfo]::new()
            $info.FileName = $candidate; $info.Arguments = '--version'
            $info.UseShellExecute = $false; $info.CreateNoWindow = $true
            $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
            $process = [Diagnostics.Process]::Start($info)
            if (-not $process.WaitForExit(5000)) { $process.Kill(); $process.Dispose(); continue }
            $output = $process.StandardOutput.ReadToEnd(); $code = $process.ExitCode; $process.Dispose()
            if ($code -eq 0 -and $output -match 'codex-cli (\d+\.\d+\.\d+)' -and [version]$Matches[1] -ge [version]'0.160.1') { return $candidate }
        } catch { continue }
    }
    return $null
}
function Safe-Child([string]$parent, [string]$child) {
    $result = [IO.Path]::GetFullPath((Join-Path $parent $child))
    if (-not $result.StartsWith($parent.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installation path.' }
    return $result
}
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    New-Item -ItemType Directory -Force -Path $installBase | Out-Null
    $codexPath = if ($PreferBundled) { $null } else { Find-Codex }
    $mode = if ($codexPath) { 'slim' } else { 'full' }
    $destination = Safe-Child $installBase ('v1.4.0-' + $mode)
    $app = Join-Path $destination 'AI-Coaster-Studio'
    $marker = Join-Path $destination 'installed.json'
    if (-not (Test-Path -LiteralPath $marker)) {
        Write-Host 'Preparing AI Coaster Studio...'
        if ($codexPath) { Write-Host 'Existing Codex detected. The large Codex bundle will NOT be downloaded.' }
        else { Write-Host 'Compatible Codex was not found. The full runtime is required for this PC.' }
        $manifest = Invoke-RestMethod $manifestUrl -TimeoutSec 30
        if ($manifest.version -ne '1.4.0') { throw 'Unexpected release version.' }
        $asset = $manifest.$mode
        if ($asset.url -notmatch '^https://github\.com/NY-colab/ai-coaster-studio/releases/download/v1\.4\.0/[A-Za-z0-9._-]+\.zip$' -or $asset.sha256 -notmatch '^[a-f0-9]{64}$' -or $asset.bytes -le 0 -or $asset.bytes -gt 500000000) { throw 'Invalid release manifest.' }
        if (Test-Path -LiteralPath $destination) { throw 'An incomplete installation exists. Keep it and use a fresh folder for START-LITE.' }
        $stageName = 'setup-' + [guid]::NewGuid().ToString('N')
        $stage = Safe-Child $installBase $stageName
        New-Item -ItemType Directory -Path $stage | Out-Null
        $archivePath = Join-Path $stage 'app.zip'
        Write-Host ('Downloading required files: {0:N1} MB (first run only)' -f ($asset.bytes/1000000))
        Invoke-WebRequest $asset.url -UseBasicParsing -TimeoutSec 600 -OutFile $archivePath
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) { throw 'Checksum mismatch. The download will not be executed.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
        try { foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if (-not $name.StartsWith('AI-Coaster-Studio/') -or $name -match '(^|/)\.\.(/|$)' -or $name.Contains(':')) { throw 'Unsafe archive path.' }
        } } finally { $archive.Dispose() }
        $expanded = Join-Path $stage 'expanded'
        Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded
        $extractedApp = Join-Path $expanded 'AI-Coaster-Studio'
        $version = (Get-Content -LiteralPath (Join-Path $extractedApp 'package.json') -Raw | ConvertFrom-Json).version
        if ($version -ne $manifest.version) { throw 'Application version mismatch.' }
        # Move only verified staging content inside this installer directory; never overwrite a prior install.
        $checkedSource = Safe-Child $installBase (Join-Path $stageName 'expanded')
        Move-Item -LiteralPath $checkedSource -Destination $destination
        @{ version=$version; mode=$mode; sha256=$asset.sha256 } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
        # Only the downloaded ZIP is removed; no recursive deletion or user data cleanup.
        Remove-Item -LiteralPath $archivePath
    }
    $node = Join-Path $app 'runtime/node.exe'
    $installed = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    if ($installed.version -ne '1.4.0' -or $installed.mode -ne $mode) { throw 'Invalid installation record.' }
    if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath (Join-Path $app 'launcher.mjs'))) { throw 'Installation files are incomplete. Unzip the starter into a new folder.' }
    if ($mode -eq 'slim') { $env:COASTER_CODEX_PATH = $codexPath }
    else { $env:COASTER_CODEX_PATH = Join-Path $app 'runtime/codex/codex.exe' }
    $env:COASTER_DATA_DIR = Join-Path $installBase 'data'
    if ($PrepareOnly) { Write-Host "READY mode=$mode app=$app"; exit 0 }
    Write-Host 'Opening the operator connection page...'
    & $node (Join-Path $app 'launcher.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Unable to start. Check app/data/startup.log.' }
} catch { Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
