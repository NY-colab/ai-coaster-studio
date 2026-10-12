import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('Windows 5.1 installer: verified install, cached offline start, checksum and traversal rejection', {skip:process.platform!=='win32'}, () => {
  const work = path.resolve('work'); mkdirSync(work,{recursive:true});
  const tmp=mkdtempSync(path.join(work,'경량 설치 test-'));
  const quote = s => "'"+s.replaceAll("'","''")+"'";
  // Match a CMD double-click; do not inject the development host's PowerShell 7 modules into 5.1.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  const ps = code => spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env,encoding:'utf8',windowsHide:true,timeout:120000});
  const archive=path.join(tmp,'good.zip'), bad=path.join(tmp,'bad.zip');
  const made=ps(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; Add-Type -AssemblyName System.IO.Compression
foreach($pair in @(@(${quote(archive)},'AI-Coaster-Studio/'),@(${quote(bad)},'../'))) {
 $z=[IO.Compression.ZipFile]::Open($pair[0],[IO.Compression.ZipArchiveMode]::Create)
 try { foreach($name in @('package.json','launcher.mjs','runtime/node.exe')) {
  $e=$z.CreateEntry($pair[1]+$name); $w=New-Object IO.StreamWriter($e.Open())
  try { $w.Write('{"version":"1.4.2"}') } finally { $w.Dispose() }
 } } finally { $z.Dispose() }
}`);
  assert.equal(made.status,0,made.stderr);
  const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
  const run=(name,file,checksum,offline=false)=>{
    const manifest={version:'1.4.2',full:{url:'https://github.com/NY-colab/ai-coaster-studio/releases/download/v1.4.2/test.zip',sha256:checksum,bytes:readFileSync(file).length}};
    const harness=path.join(tmp,'harness.ps1');
    writeFileSync(harness,`Import-Module Microsoft.PowerShell.Utility
function Invoke-RestMethod { ${offline ? "throw 'Unexpected network on cached run'" : "return ('"+JSON.stringify(manifest)+"' | ConvertFrom-Json)"} }
function Invoke-WebRequest { param($Url,[switch]$UseBasicParsing,$TimeoutSec,$OutFile) Copy-Item -LiteralPath ${quote(file)} -Destination $OutFile }
& ${quote(path.resolve('installer/START-LITE.ps1'))} -PreferBundled -PrepareOnly -InstallRoot ${quote(path.join(tmp,name))}
exit $LASTEXITCODE
`, 'utf8');
    // Explicit Unicode BOM for Windows PowerShell 5.1 paths.
    writeFileSync(harness,'\ufeff'+readFileSync(harness,'utf8'));
    return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',harness],{env,encoding:'utf8',windowsHide:true,timeout:120000});
  };
  const first=run('정상 설치',archive,sha(archive)); assert.equal(first.status,0,first.stdout+first.stderr); assert.match(first.stdout,/READY mode=full/);
  const cached=run('정상 설치',archive,sha(archive),true); assert.equal(cached.status,0,cached.stdout+cached.stderr); assert.doesNotMatch(cached.stdout,/Downloading/);
  const corrupt=run('checksum',archive,'0'.repeat(64)); assert.equal(corrupt.status,1); assert.match(corrupt.stdout,/Checksum mismatch/);
  const traversal=run('traversal',bad,sha(bad)); assert.equal(traversal.status,1); assert.match(traversal.stdout,/Unsafe archive path/);
});

// Exercise the actual CMD entry point with an inherited, invalid module directory.
test('CMD bootstrap restores Windows PowerShell modules', {skip:process.platform!=='win32'}, () => {
  const tmp=mkdtempSync(path.resolve('work/cmd-environment-'));
  writeFileSync(path.join(tmp,'START-LITE.cmd'),readFileSync('installer/START-LITE.cmd'));
  writeFileSync(path.join(tmp,'START-LITE.ps1'),"$ErrorActionPreference='Stop'; (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Algorithm");
  const result=spawnSync('cmd.exe',['/d','/c','START-LITE.cmd'],{cwd:tmp,env:{...process.env,PSModulePath:path.join(tmp,'unavailable-modules')},encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/SHA256/);
});
