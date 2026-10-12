// Add a small bootstrap and Codex-free bridge to an existing verified portable release.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const full = path.join(release, 'AI-Coaster-Studio-Windows-x64.zip');
const slim = path.join(release, 'AI-Coaster-Studio-Bridge.zip');
const starter = path.join(release, 'AI-Coaster-Studio-Lite.zip');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version;
const original = JSON.parse(readFileSync(path.join(release, 'SHA256SUMS.json')));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
if (version !== '1.4.0' || original.version !== version || hash(full) !== original.portableZip.sha256) throw Error('Verified v1.4.0 portable archive required');
if (existsSync(slim) || existsSync(starter)) throw Error('Output already exists; preserve published archives and use a fresh build folder.');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$inputZip=[IO.Compression.ZipFile]::OpenRead(${quote(full)})
$outputZip=[IO.Compression.ZipFile]::Open(${quote(slim)},[IO.Compression.ZipArchiveMode]::Create)
try {
 foreach($entry in $inputZip.Entries) {
  $name=$entry.FullName.Replace('\\','/')
  if($name.StartsWith('AI-Coaster-Studio/runtime/codex/')) { continue }
  $copy=$outputZip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
  $copy.LastWriteTime=$entry.LastWriteTime
  $sourceStream=$entry.Open(); $targetStream=$copy.Open()
  try { $sourceStream.CopyTo($targetStream) } finally { $sourceStream.Dispose(); $targetStream.Dispose() }
 }
} finally { $inputZip.Dispose(); $outputZip.Dispose() }
Compress-Archive -LiteralPath ${quote(path.join(root,'installer'))} -DestinationPath ${quote(starter)} -CompressionLevel Optimal
`], {windowsHide:true, stdio:'inherit'});
const asset = file => ({url:`https://github.com/NY-colab/ai-coaster-studio/releases/download/v${version}/${path.basename(file)}`,sha256:hash(file),bytes:statSync(file).size});
const manifest = {version, slim:asset(slim), full:asset(full), starter:asset(starter)};
writeFileSync(path.join(release,'LITE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
