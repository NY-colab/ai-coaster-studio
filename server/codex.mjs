import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, DATA, CODEX_HOME_DIR, scrubEnv, appError, writeJSON, generationPrompt } from './common.mjs';
const exec = promisify(execFile);
let cachedCLI;
export async function findCLI() {
  if (cachedCLI) return cachedCLI;
  const candidates = [process.env.COASTER_CODEX_PATH, path.join(ROOT, 'runtime', 'codex', 'codex.exe')].filter(Boolean);
  try { const { stdout } = await exec('where.exe', ['codex.exe'], { windowsHide: true, timeout: 5000 }); candidates.push(...stdout.trim().split(/\r?\n/)); } catch {}
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).InstallLocation"], { windowsHide: true, timeout: 10000 });
    if (stdout.trim()) candidates.push(path.join(stdout.trim(), 'app', 'resources', 'codex.exe'));
  } catch {}
  for (const candidate of candidates) try { const st = await fs.stat(candidate); if (st.isFile()) return cachedCLI = candidate; } catch {}
  throw appError('Codex 실행 파일을 찾지 못했습니다. 실행용 ZIP 전체를 다시 압축 해제해 주세요.', 'CLI_MISSING', 503);
}
export async function diagnose() {
  try {
    const cli = await findCLI();
    const opts = { windowsHide: true, timeout: 15000, env: scrubEnv() };
    const [version, authResult] = await Promise.all([exec(cli, ['--version'], opts), exec(cli, ['--no-daemon', 'login', 'status'], opts).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }))]);
    const text = authResult.stdout + authResult.stderr;
    const auth = /Logged in using ChatGPT/i.test(text) ? 'chatgpt' : /API key/i.test(text) ? 'api-key' : /not logged|log in|login/i.test(text) ? 'missing' : 'unknown';
    return { ready: auth === 'chatgpt', cliVersion: version.stdout.trim(), auth, message: auth === 'chatgpt' ? 'ChatGPT 로그인 연결됨' : auth === 'api-key' ? 'API 키 인증이 감지되었습니다. ChatGPT 계정으로 로그인해 주세요.' : 'ChatGPT 계정으로 로그인해 주세요.' };
  } catch (e) { return { ready: false, cliVersion: null, auth: 'missing', message: e.message }; }
}
export async function startWorker(job, folder, inputPath, authorize=()=>{}) {
  const cli = await findCLI();
  await writeJSON(path.join(folder, 'provider-schema.json'), { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['success','unavailable','failed'] }, image_path: { type: ['string','null'] }, error: { type: ['string','null'] } }, required: ['status','image_path','error'] });
  await writeJSON(path.join(folder, 'worker.json'), { cli, folder, inputPath, prompt: generationPrompt(job.style), codexHome: CODEX_HOME_DIR, remote:job.remote||null, parentPid:process.pid });
  authorize();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'worker.mjs'), path.join(folder, 'worker.json')], { detached: true, windowsHide: true, stdio: 'ignore', env: scrubEnv() });
  job.runnerPid=child.pid;
  await new Promise((resolve,reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return child.pid;
}
export let loginState = { status: 'idle' };
export async function startLogin() {
  if (loginState.status === 'running') return loginState;
  loginState = { status: 'running', message: '로그인 코드를 준비하고 있습니다.' };
  let cli;
  try { cli = await findCLI(); } catch (e) { loginState = { status: 'failed', message: e.message }; throw e; }
  const child = spawn(cli, ['--no-daemon','login','--device-auth'], { windowsHide: true, env: scrubEnv(), stdio: ['ignore','pipe','pipe'] });
  let text = '';
  const collect = chunk => {
    text = (text + chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-12000);
    const url = text.match(/https:\/\/(?:auth\.openai\.com|chatgpt\.com)\/[^\s\x1b]+/);
    const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b|\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
    loginState = { status: 'running', message: '로그인 페이지를 열고 표시된 코드를 입력해 주세요.', ...(url ? { url: url[0] } : {}), ...(code ? { code: code[0] } : {}) };
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  child.on('error', () => { loginState = { status: 'failed', message: '로그인을 시작하지 못했습니다. 실행 파일과 네트워크를 확인해 주세요.' }; });
  child.on('close', code => { loginState = code === 0 ? { status: 'complete', message: '로그인되었습니다.' } : { status: 'failed', message: '로그인이 완료되지 않았습니다. 기기 코드 로그인이 허용되어 있는지 확인한 후 다시 시도해 주세요.' }; });
  return loginState;
}
