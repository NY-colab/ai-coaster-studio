export const hosted = import.meta.env.VITE_HOSTED === '1';
const storageKey = 'coaster-web-session-v1';
type Session = { backend: string; bearer: string; expiresAt: number };
let session: Session | null = null;
function validHost(value: string) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname) || u.port || u.username || u.password) throw new Error('운영자 앱에서 만든 행사 링크를 입력해 주세요.');
  return u.origin;
}
if (hosted) try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (saved && saved.expiresAt > Date.now() && /^[a-f0-9]{64}$/.test(saved.bearer)) session = { ...saved, backend: validHost(saved.backend) };
} catch { /* An unavailable browser store does not prevent a new connection. */ }
export const hasConnection = () => !!session;
export function disconnect() { session = null; try { sessionStorage.removeItem(storageKey); } catch {} }
export function parseInvite(value: string) {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error('운영자에게 받은 행사 링크 전체를 붙여넣어 주세요.'); }
  const params = new URLSearchParams(u.hash.slice(1));
  const backend = validHost(params.get('host') || u.origin);
  const code = params.get('join');
  if (!code || !/^[\w-]{8,80}$/.test(code)) throw new Error('접속 코드가 포함된 행사 링크가 필요합니다. 운영자 앱에서 링크 복사를 눌러 주세요.');
  return { backend, code };
}
export async function connect(value: string) {
  const { backend, code } = parseInvite(value);
  let response: Response;
  try { response = await fetch(backend + '/api/web-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('운영자 PC에 연결할 수 없습니다. PC와 체험이 켜져 있는지, 운영자 앱이 v1.3.0 이상인지 확인해 주세요.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '행사 연결을 확인해 주세요.');
  if (!/^[a-f0-9]{64}$/.test(result.bearer) || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error('유효한 행사 연결을 받지 못했습니다.');
  session = { backend, bearer: result.bearer, expiresAt: result.expiresAt };
  try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch {}
}
export async function appFetch(path: string, options: RequestInit = {}) {
  if (!hosted) return fetch(path, options);
  if (!session) throw new Error('운영자 PC의 행사 링크를 먼저 연결해 주세요.');
  if (!path.startsWith('/api/')) throw new Error('허용되지 않은 요청입니다.');
  const headers = new Headers(options.headers); headers.set('Authorization', 'Bearer ' + session.bearer);
  const response = await fetch(session.backend + path, { ...options, headers, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status === 401) { disconnect(); window.dispatchEvent(new Event('coaster-web-disconnect')); }
  if (response.status === 410) { disconnect(); window.dispatchEvent(new Event('coaster-event-closed')); }
  return response;
}
