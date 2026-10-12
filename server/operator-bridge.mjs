import crypto from 'node:crypto';

export const OPERATOR_ORIGIN = 'https://ny-colab.github.io';
export const OPERATOR_PAGE = OPERATOR_ORIGIN + '/ai-coaster-studio/';
const fail = (message, statusCode = 403) => Object.assign(new Error(message), {statusCode, code:'OPERATOR_CONNECTION'});
const equal = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') return false; const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); };

// This bridge is only reachable over loopback. Event gateways never forward its routes.
export function installOperatorBridge(app, {token, backend, now = Date.now}) {
  const pairs = new Map(), sessions = new Map();
  const prune = () => { for (const map of [pairs, sessions]) for (const [key, expires] of map) if (expires <= now()) map.delete(key); };
  app.addContentTypeParser('application/x-www-form-urlencoded', {parseAs:'string', bodyLimit:2048}, (_req, value, done) => done(null, Object.fromEntries(new URLSearchParams(value))));
  app.addHook('onRequest', async (req, reply) => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) throw fail('허용되지 않은 호스트입니다.');
    if (req.headers.origin !== OPERATOR_ORIGIN) return;
    if (req.headers['x-coaster-participant'] || req.headers['x-coaster-event']) throw fail('참가자 연결로 운영할 수 없습니다.');
    const pathname = req.url.split('?')[0];
    if (!pathname.startsWith('/api/')) throw fail('허용되지 않은 요청입니다.');
    reply.header('Access-Control-Allow-Origin', OPERATOR_ORIGIN).header('Vary','Origin');
    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if (!['GET','POST','PATCH','DELETE'].includes(method) || headers.some(h=>!['authorization','content-type','x-coaster-token'].includes(h))) throw fail('허용되지 않은 요청입니다.');
      return reply.header('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE').header('Access-Control-Allow-Headers','Authorization, Content-Type, X-Coaster-Token').header('Access-Control-Allow-Private-Network','true').code(204).send();
    }
    prune();
    if (pathname === '/api/operator-session' && req.method === 'POST') { req.operatorPair = true; return; }
    const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!bearer || !sessions.has(bearer)) throw fail('이 PC 연결이 만료되었습니다. 연결 프로그램에서 다시 연결해 주세요.', 401);
    req.operatorWeb = true;
    req.operatorBearer = bearer;
  });
  app.get('/web-operator', async (req, reply) => {
    // A local confirmation is required before any authority is issued to a web tab.
    reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://ny-colab.github.io; frame-ancestors 'none'; base-uri 'none'");
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>이 PC 연결 · 동그란 순간</title><style>body{background:#faf8f2;color:#354c3c;font:16px/1.7 system-ui;margin:0;padding:8vh 24px}main{max-width:560px;margin:auto;background:white;padding:36px;border-radius:24px}button{background:#405c48;color:white;border:0;padding:18px;width:100%;border-radius:12px;font-size:17px;cursor:pointer}small{color:#777}a{color:#405c48}</style><main><small>운영자 PC 연결 프로그램</small><h1>이 PC로 공방을 운영할까요?</h1><p>GitHub 웹앱에서 이 컴퓨터의 Codex 로그인, 사진 생성, 참가자 QR 발급·종료를 관리합니다. 연결할 웹앱: <b>ny-colab.github.io/ai-coaster-studio/</b></p><form method="post" action="/web-operator"><input type="hidden" name="token" value="${token}"><button>이 PC를 웹 운영자 화면에 연결</button></form><p>다음 화면에서 브라우저가 <b>이 기기의 앱 / 로컬 네트워크 접근</b>을 물으면 허용해 주세요. 행사 중에는 이 연결 프로그램을 켜 두세요.</p><small>각 운영자의 Codex 인증과 작품은 각자의 PC에 보관됩니다. <a href="/">로컬 운영 화면 열기</a></small></main></html>`);
  });
  app.post('/web-operator', async (req, reply) => {
    if (req.headers.origin !== 'http://' + req.headers.host || !equal(req.body?.token, token)) throw fail('이 PC 연결 화면에서 버튼을 눌러 주세요.');
    prune();
    if (pairs.size >= 20) throw fail('잠시 후 다시 연결해 주세요.',429);
    const code = crypto.randomBytes(32).toString('hex'); pairs.set(code,now()+120000);
    return reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').code(303).redirect(OPERATOR_PAGE+'#operator='+encodeURIComponent(backend())+'&pair='+code);
  });
  app.post('/api/operator-session', async req => {
    if (!req.operatorPair) throw fail('웹 운영자 화면에서 연결해 주세요.');
    prune();
    const code = req.body?.code;
    if (typeof code !== 'string' || !pairs.has(code)) throw fail('PC 연결 링크가 만료되었거나 이미 사용되었습니다. 연결 프로그램에서 다시 연결해 주세요.',401);
    if (sessions.size >= 20) throw fail('열려 있는 운영자 연결을 닫고 다시 시도해 주세요.',429);
    pairs.delete(code);
    const bearer = crypto.randomBytes(32).toString('hex'), expiresAt = now()+12*3600000;
    sessions.set(bearer,expiresAt);
    return {bearer, expiresAt};
  });
  app.delete('/api/operator-session', async req => {
    if (!req.operatorWeb) throw fail('웹 운영자 연결이 필요합니다.');
    sessions.delete(req.operatorBearer); return {ok:true};
  });
}
