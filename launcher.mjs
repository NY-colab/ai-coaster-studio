import { fork, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.COASTER_DATA_DIR || path.join(root, 'data'));
const statePath = path.join(dataDir, 'launcher.json');
const logPath = path.join(dataDir, 'startup.log');
const serverPath = path.join(root, 'server', 'index.mjs');
mkdirSync(dataDir, { recursive: true });

function scrub(value) {
  return String(value).replace(/(?:sk-[\w-]{12,}|Bearer\s+\S+|\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*\S+)/gi, '[redacted]').slice(0, 1500);
}
function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${scrub(message)}\n`);
}
function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^\/\/?$/.test(url.pathname);
  } catch { return false; }
}
async function ping(url) {
  if (!validUrl(url)) return false;
  try {
    const response = await fetch(new URL('/api/ping', url), { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const info = await response.json();
    return info?.app === 'coaster-studio' && info?.version === '1.1.1';
  } catch { return false; }
}
function isLive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function openBrowser(url) {
  if(process.env.COASTER_NO_OPEN==='1')return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.once('error', error => log(`Browser open failed: ${error.message}. Open ${url} manually.`));
  child.unref();
}
async function start() {
  if (!existsSync(serverPath)) throw new Error('server/index.mjs is missing');
  try {
    const prior = JSON.parse(readFileSync(statePath, 'utf8'));
    if (prior.root === root && isLive(prior.pid) && await ping(prior.url)) {
      console.log(`COASTER_URL=${prior.url}`);
      openBrowser(prior.url);
      return;
    }
  } catch { /* Absent or stale state. */ }

  const child = fork(serverPath, [], {
    cwd: root, env: { ...process.env, COASTER_DATA_DIR: dataDir },
    detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let startupError = '';
  const collect = chunk => { startupError = (startupError + chunk.toString()).slice(-5000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let timeout;
  const url = await new Promise((resolve, reject) => {
    const fail = error => { clearTimeout(timeout); reject(error); };
    timeout = setTimeout(() => fail(new Error(`Server startup timed out. ${startupError}`)), 30000);
    child.once('error', fail);
    child.once('exit', code => fail(new Error(`Server exited (${code}). ${startupError}`)));
    child.on('message', message => {
      if (message?.type === 'ready' && validUrl(message.url)) {
        clearTimeout(timeout);
        resolve(message.url);
      }
    });
  });
  if (!await ping(url)) throw new Error(`Server did not pass identity check at ${url}`);
  writeFileSync(statePath, JSON.stringify({ pid: child.pid, url, root }), 'utf8');
  console.log(`COASTER_URL=${url}`);
  openBrowser(url);
  child.stdout.destroy();
  child.stderr.destroy();
  child.disconnect();
  child.unref();
}
start().catch(error => { log(error?.message || error); console.error(scrub(error?.message || error)); process.exitCode = 1; });
