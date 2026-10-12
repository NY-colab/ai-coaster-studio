// Build Windows x64 portable and source archives from an explicit allowlist.
// Run with Node 24.11.1 on Windows after application files are complete.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const work = path.join(release, '.package-work');
const app = path.join(work, 'portable', 'AI-Coaster-Studio');
const source = path.join(work, 'source', 'AI-Coaster-Studio-source');
const NODE_VERSION = '24.11.1';
const CODEX_VERSION = '0.160.1';
const TUNNEL_VERSION='2026.10.0';
const TUNNEL_SHA256='86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c';
const nodeArchive = `node-v${NODE_VERSION}-win-x64.zip`;

function assert(condition, message) { if (!condition) throw new Error(message); }
function run(command, args, cwd = root) {
  if (command === 'npm.cmd') {
    const npmCmd=execFileSync('where.exe',['npm.cmd'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
    const npmCli=path.join(path.dirname(npmCmd),'node_modules','npm','bin','npm-cli.js');
    assert(existsSync(npmCli),'npm CLI script not found');args=[npmCli,...args];command=process.execPath;
  }
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false });
  assert(result.status === 0, `${command} failed (${result.status ?? result.error?.message})`);
}
function copy(src, dst) {
  assert(existsSync(src), `Required input missing: ${src}`);
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, force: true });
}
function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
async function download(url, dst) {
  const response = await fetch(url);
  assert(response.ok, `Download failed: ${url} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, bytes);
}
function zip(folder, filename) {
  if (existsSync(filename)) rmSync(filename);
  // Windows PowerShell's archive command preserves the top-level folder.
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath '${folder.replaceAll("'", "''")}' -DestinationPath '${filename.replaceAll("'", "''")}' -CompressionLevel Optimal`], release);
}

assert(process.platform === 'win32' && process.arch === 'x64', 'Package on Windows x64');
assert(process.version === `v${NODE_VERSION}`, `Node ${NODE_VERSION} required; found ${process.version}`);
assert(existsSync(path.join(root, 'server', 'index.mjs')), 'Server is not ready');
assert(existsSync(path.join(root, 'src')), 'Frontend is not ready');
mkdirSync(release, { recursive: true });
assert(path.relative(root,work) === path.join('release','.package-work'), 'Unsafe packaging work path');
if (existsSync(work) && !process.argv.includes('--reuse')) rmSync(work, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
mkdirSync(source, { recursive: true });

// Staged application/source folders are always fresh, even when reusing runtime downloads.
for(const target of [app,source]){assert(path.relative(work,target).split(path.sep)[0]!== '..','Unsafe staging path');rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});}
console.log('Building UI...');
run('npm.cmd', ['run', 'build']);

const nodeBase = `https://nodejs.org/dist/v${NODE_VERSION}`;
const nodeDownload = path.join(work, 'downloads', nodeArchive);
const sumDownload = path.join(work, 'downloads', 'SHASUMS256.txt');
console.log('Downloading official Node.js Windows x64 release...');
if (!existsSync(nodeDownload)) await download(`${nodeBase}/${nodeArchive}`, nodeDownload);
if (!existsSync(sumDownload)) await download(`${nodeBase}/SHASUMS256.txt`, sumDownload);
const checksumLine = readFileSync(sumDownload, 'utf8').split(/\r?\n/).find(line => line.trim().endsWith(`  ${nodeArchive}`));
assert(checksumLine, 'Official Node checksum not found');
assert(checksumLine.split(/\s+/)[0].toLowerCase() === sha256(nodeDownload), 'Node archive checksum mismatch');
const nodeExtract = path.join(work, 'node-extract');
mkdirSync(nodeExtract, { recursive: true });
run('tar.exe', ['-xf', nodeDownload, '-C', nodeExtract]);
const nodeDir = path.join(nodeExtract, `node-v${NODE_VERSION}-win-x64`);
copy(path.join(nodeDir, 'node.exe'), path.join(app, 'runtime', 'node.exe'));
copy(path.join(nodeDir, 'LICENSE'), path.join(app, 'runtime', 'NODE-LICENSE.txt'));

console.log('Installing official Codex CLI package in isolated build folder...');
const cliDir = path.join(work, 'cli-install');
mkdirSync(cliDir, { recursive: true });
writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify({ private: true, dependencies: { '@openai/codex': CODEX_VERSION } }));
run('npm.cmd', ['install', '--prefix', cliDir, '--ignore-scripts', '--no-audit', '--no-fund']);
const cliPkg = path.join(cliDir, 'node_modules', '@openai', 'codex');
const winPkg = existsSync(path.join(cliPkg, 'node_modules', '@openai', 'codex-win32-x64')) ? path.join(cliPkg, 'node_modules', '@openai', 'codex-win32-x64') : path.join(cliDir, 'node_modules', '@openai', 'codex-win32-x64');
assert(JSON.parse(readFileSync(path.join(cliPkg, 'package.json'), 'utf8')).version === CODEX_VERSION, 'Wrong Codex wrapper version');
assert(JSON.parse(readFileSync(path.join(winPkg, 'package.json'), 'utf8')).version === `${CODEX_VERSION}-win32-x64`, 'Wrong Codex native version');
const vendor = path.join(winPkg, 'vendor', 'x86_64-pc-windows-msvc');
const cliRuntime = path.join(app, 'runtime', 'codex');
mkdirSync(cliRuntime, { recursive: true });
for (const entry of readdirSync(vendor)) {
  if (entry === 'bin') continue;
  copy(path.join(vendor, entry), path.join(cliRuntime, entry));
}
for (const entry of readdirSync(path.join(vendor, 'bin'))) {
  copy(path.join(vendor, 'bin', entry), path.join(cliRuntime, entry));
}
run(path.join(cliRuntime, 'codex.exe'), ['--version']);

console.log('Installing production npm dependencies...');
for (const name of ['package.json', 'package-lock.json']) copy(path.join(root, name), path.join(app, name));
run('npm.cmd', ['ci', '--omit=dev', '--no-audit', '--no-fund'], app);
run(path.join(app, 'runtime', 'node.exe'), ['-e', "require('sharp'); require('fastify'); console.log('production modules ready')"], app);

const tunnel=path.join(root,'share','cloudflared.exe');
if(!existsSync(tunnel))await download(`https://github.com/cloudflare/cloudflared/releases/download/${TUNNEL_VERSION}/cloudflared-windows-amd64.exe`,tunnel);
assert(sha256(tunnel)===TUNNEL_SHA256,'Cloudflared checksum mismatch');

for (const name of ['UPDATE.cmd','UPDATE.ps1','README.md','CHANGELOG.md','LICENSE','dist', 'server', 'launcher.mjs', 'START.cmd', 'START.vbs', 'README.ko.md', 'THIRD-PARTY-NOTICES.md', 'share', 'share-launcher.mjs', 'share-server.mjs', 'START_SHARE.vbs', 'START_SHARE.cmd', 'STOP_SHARE.vbs', 'REMOTE.ko.md']) copy(path.join(root, name), path.join(app, name));
mkdirSync(path.join(app, 'data'), { recursive: true });
writeFileSync(path.join(app, 'data', '.keep'), 'User data is created here at runtime.\n');

const sourceFiles = [
  'UPDATE.cmd','UPDATE.ps1','README.md','CHANGELOG.md','LICENSE','.github','src', 'server', 'scripts', 'installer', 'tests', 'index.html', 'package.json', 'package-lock.json',
  'tsconfig.json', 'vite.config.ts', 'launcher.mjs', 'START.cmd', 'START.vbs',
  'README.ko.md', 'THIRD-PARTY-NOTICES.md', '.gitignore',
  'share-launcher.mjs', 'share-server.mjs', 'START_SHARE.vbs', 'START_SHARE.cmd', 'STOP_SHARE.vbs', 'REMOTE.ko.md',
];
for (const name of sourceFiles) if (existsSync(path.join(root, name))) copy(path.join(root, name), path.join(source, name));

copy(path.join(root,'share','LICENSE.txt'),path.join(source,'share','LICENSE.txt'));
const portableZip = path.join(release, 'AI-Coaster-Studio-Windows-x64.zip');
const sourceZip = path.join(release, 'AI-Coaster-Studio-source.zip');
console.log('Creating release archives...');
zip(app, portableZip);
zip(source, sourceZip);
const manifest = {
  version:JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,cloudflaredVersion:TUNNEL_VERSION,cloudflaredSha256:TUNNEL_SHA256,builtAt: new Date().toISOString(), nodeVersion: NODE_VERSION, codexVersion: CODEX_VERSION,
  nodeSource: `${nodeBase}/${nodeArchive}`, nodeArchiveSha256: sha256(nodeDownload),
  portableZip: { name: path.basename(portableZip), sha256: sha256(portableZip) },
  sourceZip: { name: path.basename(sourceZip), sha256: sha256(sourceZip) },
};
writeFileSync(path.join(release, 'SHA256SUMS.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
console.log(`Archives ready in ${release}`);
