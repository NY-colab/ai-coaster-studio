import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loginPage = message => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>동그란 순간 · 행사 입장</title><style>body{margin:0;background:#faf8f0;color:#29483e;font:17px 'Malgun Gothic',sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:420px;margin:24px;padding:40px;background:white;border:1px solid #e8e6dc;border-radius:28px}small{color:#9a704f}h1{font-size:32px}p{line-height:1.7;color:#727a72}input,button{box-sizing:border-box;width:100%;padding:16px;border-radius:12px;font:inherit}input{border:1px solid #d9ded7;margin:8px 0 16px}button{background:#365f4c;color:white;border:0;cursor:pointer}.error{color:#ae493f}label{font-weight:bold}</style><main><small>AI 티코스터 공방</small><h1>동그란 순간</h1><p>사진 한 장으로 만드는 나만의 티코스터.<br>운영자에게 받은 행사 접속 코드를 입력해 주세요.</p><form method="post" action="/enter"><label for="code">행사 접속 코드</label><input id="code" name="code" type="password" autocomplete="off" required maxlength="80" placeholder="접속 코드 입력"><button>공방 입장하기 →</button></form>${message?`<p class="error" role="alert">${escape(message)}</p>`:''}<p style="font-size:13px">사진과 작품은 운영자 PC에 보관됩니다. AI 생성에 필요한 사진은 Codex로 전송됩니다. 이 기기에서 만든 사진과 작품만 볼 수 있습니다.</p></main><script src="/entry.js" defer></script></html>`;
async function body(req, limit) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>limit)throw Object.assign(new Error('파일이 너무 큽니다.'),{status:413});chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const safeEqual=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const permitted=(method,pathname)=>{
  if(['GET','HEAD'].includes(method))return pathname==='/' || /^\/assets\/[\w.-]+$/.test(pathname) || ['/api/health','/api/jobs','/api/calibration.pdf'].includes(pathname) || /^\/api\/photos\/[0-9a-f-]{36}$/.test(pathname) || /^\/api\/jobs\/[0-9a-f-]{36}(\/image)?$/.test(pathname);
  if(method==='POST')return ['/api/photos','/api/jobs','/api/export'].includes(pathname);
  return method==='PATCH'&&/^\/api\/jobs\/[0-9a-f-]{36}\/edit$/.test(pathname);
};

export function createGateway({backend,code,publicOrigin='',secureCookies=true,eventId,internalSecret,backendToken,authorize=()=>{},expiresAt=Date.now()+12*3600000,controllers=new Set()}) {
  const sessions=new Map(),attempts=new Map(); let origin=publicOrigin,globalAttempts=[],revoked=false;
  const upstream=new URL(backend);
  if(upstream.hostname!=='127.0.0.1'||upstream.protocol!=='http:')throw new Error('Local backend required');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    const html=(status,message)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(loginPage(message));};
    try {
      if(!origin||req.headers.host!==new URL(origin).host)return json(403,{error:'허용되지 않은 접속 주소입니다.'});
      if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'다른 사이트에서 보낸 요청은 허용되지 않습니다.'});
      if(revoked) return json(410,{error:'체험이 종료되었습니다.',code:'EVENT_CLOSED'});
      authorize();
      const pathname=new URL(req.url,origin).pathname;
      if(pathname==='/entry.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end("const c=new URLSearchParams(location.hash.slice(1)).get('join');if(c){history.replaceState(null,'','/');document.getElementById('code').value=c;document.querySelector('form').requestSubmit();}");}
      const unsafe=!['GET','HEAD'].includes(req.method);
      if(unsafe&&req.headers.origin!==origin)return json(403,{error:'페이지를 새로고침한 뒤 다시 시도해 주세요.'});
      const now=Date.now();
      for(const [id,s] of sessions)if(s.expires<now)sessions.delete(id);
      for(const [ip,a] of attempts)if(now-a.since>60000)attempts.delete(ip);
      if(pathname==='/enter'&&req.method==='POST') {
        const ip=String(req.headers['cf-connecting-ip']||req.socket.remoteAddress);
        const attempt=attempts.get(ip)||{since:now,count:0};attempts.set(ip,attempt);
        globalAttempts=globalAttempts.filter(t=>now-t<60000);
        if(attempt.count>8||globalAttempts.length>100){res.setHeader('Retry-After','60');return html(429,'입력 횟수가 많습니다. 1분 후 다시 시도해 주세요.');}
        const form=new URLSearchParams((await body(req,2048)).toString());
        authorize();if(revoked)return json(410,{error:'체험이 종료되었습니다.',code:'EVENT_CLOSED'});
        if(!safeEqual(form.get('code'),code)){attempt.count++;globalAttempts.push(now);return html(401,'접속 코드가 맞지 않습니다. 운영자에게 확인해 주세요.');}
        const existing=String(req.headers.cookie||'').match(/(?:^|;\s*)coaster_session=([a-f0-9]{64})(?:;|$)/)?.[1];
        if(sessions.has(existing)){res.writeHead(303,{Location:'/'});return res.end();}
        if(sessions.size>=1000)return html(503,'접속 가능한 기기 수를 초과했습니다. 운영자에게 문의해 주세요.');
        const sid=crypto.randomBytes(32).toString('hex');
        sessions.set(sid,{participant:crypto.randomUUID(),csrf:crypto.randomBytes(32).toString('hex'),expires:Math.min(expiresAt,now+12*3600000)});
        res.setHeader('Set-Cookie',`coaster_session=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secureCookies?'; Secure':''}`);
        res.writeHead(303,{Location:'/'});return res.end();
      }
      const sid=String(req.headers.cookie||'').match(/(?:^|;\s*)coaster_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session=sessions.get(sid);
      if(!session){if(pathname==='/'||pathname==='/enter')return html(200,'');return json(401,{error:'행사 접속 코드로 다시 입장해 주세요.',code:'SESSION_REQUIRED'});}
      if(unsafe&&!safeEqual(req.headers['x-coaster-token'],session.csrf))return json(403,{error:'페이지를 새로고침한 뒤 다시 시도해 주세요.'});
      if(!permitted(req.method,pathname))return json(403,{error:'이 기능은 운영자 PC에서만 사용할 수 있습니다.',code:'OPERATOR_ONLY'});
      const headers=eventId?{'X-Coaster-Event':eventId,'X-Coaster-Event-Secret':internalSecret,'X-Coaster-Participant':session.participant}:{};if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
      if(unsafe&&backendToken)headers['X-Coaster-Token']=backendToken;
      else if(unsafe){const h=await fetch(new URL('/api/health',backend),{signal:AbortSignal.timeout(20000)});if(!h.ok)throw new Error('Backend unavailable');headers['X-Coaster-Token']=(await h.json()).token;}
      const bytes=unsafe?await body(req,16*1024*1024):undefined;
      authorize();if(revoked)return json(410,{error:'체험이 종료되었습니다.',code:'EVENT_CLOSED'});
      const controller=new AbortController();controllers.add(controller);
      const timeout=setTimeout(()=>controller.abort(),90000);
      let response;
      try {response=await fetch(new URL(pathname,backend),{method:req.method,headers,body:bytes,redirect:'error',signal:controller.signal});}
      catch(error){clearTimeout(timeout);controllers.delete(controller);throw error;}
      res.once('close',()=>{clearTimeout(timeout);controllers.delete(controller);controller.abort();});
      if(pathname==='/api/health'&&response.ok){const h=await response.json();return json(200,{ready:h.ready,cliVersion:null,auth:h.ready?'chatgpt':'missing',message:h.ready?'운영자 PC의 AI 공방에 연결되었습니다.':'운영자 PC에서 Codex 로그인 상태를 확인해 주세요.',busy:h.busy,activeJobId:h.activeJobId,login:{status:'idle'},token:session.csrf,imageGeneration:h.imageGeneration,remote:true,eventExpiresAt:new Date(expiresAt).toISOString(),version:h.version});}
      for(const key of ['content-type','content-disposition'])if(response.headers.has(key))res.setHeader(key,response.headers.get(key));
      res.writeHead(response.status);
      if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
    } catch(e) {if(!res.headersSent)json(e.statusCode||e.status||502,{error:e.statusCode||e.status?e.message:'운영자 PC 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.',code:e.code||'HOST_UNAVAILABLE'});else res.destroy();}
  });
  server.requestTimeout=120000;server.headersTimeout=15000;
  return {server,revoke(){revoked=true;sessions.clear();},setOrigin(value){const u=new URL(value);if(u.protocol!=='https:'||!u.hostname.endsWith('.trycloudflare.com'))throw new Error('Invalid tunnel origin');origin=u.origin;},close:()=>new Promise(resolve=>server.close(resolve))};
}
