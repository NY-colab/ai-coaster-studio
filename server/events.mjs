import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {createGateway} from './share-gateway.mjs';
import {ROOT,DATA,appError} from './common.mjs';

// Event authorization is deliberately memory-only: every server restart closes admission.
export class EventAccess {
  current=null;
  begin({durationMinutes=60,maxGenerations=100}={}) {
    if(this.current?.active)throw appError('이미 체험이 열려 있습니다. 먼저 종료해 주세요.','EVENT_BUSY',409);
    if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>720||!Number.isInteger(maxGenerations)||maxGenerations<1||maxGenerations>1000)throw appError('체험 시간은 1~720분, 생성 한도는 1~1000장으로 설정해 주세요.');
    return this.current={id:crypto.randomUUID(),secret:crypto.randomBytes(32).toString('hex'),code:crypto.randomBytes(9).toString('base64url'),active:true,startedAt:Date.now(),expiresAt:Date.now()+durationMinutes*60000,maxGenerations,used:0};
  }
  assert(id) {const e=this.current;if(!e||!e.active||e.id!==id||Date.now()>=e.expiresAt)throw appError('체험 시간이 종료되었습니다. 운영자에게 문의해 주세요.','EVENT_CLOSED',410);return e;}
  take(id){const e=this.assert(id);if(e.used>=e.maxGenerations)throw appError('이번 체험의 생성 수에 도달했습니다. 운영자에게 문의해 주세요.','EVENT_LIMIT',429);e.used++;}
  revoke(){if(this.current)this.current.active=false;}
}

export function createEventManager({backend,onStop,backendToken}) {
  const access=new EventAccess();let gateway,child,timer,startingTimer,stopPromise,starting=false;
  let view={status:'closed',message:'모바일 체험이 닫혀 있습니다.'};
  const controllers=new Set();
  const info=()=>({...view,...(access.current?{eventId:access.current.id,expiresAt:new Date(access.current.expiresAt).toISOString(),used:access.current.used,maxGenerations:access.current.maxGenerations}:{}),active:!!access.current?.active&&Date.now()<access.current.expiresAt});
  async function stop(reason='운영자가 체험을 종료했습니다.') {
    if(stopPromise)return stopPromise;
    const id=access.current?.id;access.revoke();view={status:'closed',message:reason};
    clearTimeout(timer);clearTimeout(startingTimer);
    for(const c of controllers)c.abort();controllers.clear();
    gateway?.revoke();child?.kill();
    stopPromise=(async()=>{try{if(id)await onStop(id);}finally{if(gateway){gateway.server.closeAllConnections();await gateway.close();gateway=null;}child=null;}})();
    try{return await stopPromise;}finally{stopPromise=null;}
  }
  async function start(options) {
    if(starting)throw appError('체험 주소를 준비 중입니다. 잠시 후 다시 시도해 주세요.','EVENT_BUSY',409);
    if(stopPromise)await stopPromise;
    const e=access.begin(options);view={status:'starting',message:'모바일 체험 주소를 준비하고 있습니다.'};
    starting=true;
    timer=setTimeout(()=>void stop('설정한 체험 시간이 종료되었습니다.'),Math.max(1,e.expiresAt-Date.now()));timer.unref();
    try{
      await fs.access(path.join(ROOT,'share','cloudflared.exe'));
      access.assert(e.id);
      gateway=createGateway({backend:backend(),code:e.code,eventId:e.id,backendToken,
        authorize:()=>access.assert(e.id),internalSecret:e.secret,expiresAt:e.expiresAt,controllers});
      await new Promise((resolve,reject)=>{gateway.server.once('error',reject);gateway.server.listen(0,'127.0.0.1',resolve);});
      access.assert(e.id);
      const config=path.join(DATA,'event-tunnel.yml');await fs.writeFile(config,'# Isolated event tunnel\n');access.assert(e.id);
      child=spawn(path.join(ROOT,'share','cloudflared.exe'),['tunnel','--config',config,'--no-autoupdate','--url','http://127.0.0.1:'+gateway.server.address().port,'--protocol','http2'],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='',published=false;
      const collect=async chunk=>{
        output=(output+chunk.toString()).slice(-10000);
        const match=output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if(match&&!published){published=true;clearTimeout(startingTimer);access.assert(e.id);gateway.setOrigin(match[0]);
          // Fragment is never transmitted in a URL request or external referrer.
          const joinUrl='https://ny-colab.github.io/ai-coaster-studio/#host='+encodeURIComponent(match[0])+'&join='+encodeURIComponent(e.code);
          const qr=await QRCode.toDataURL(joinUrl,{width:480,margin:4,errorCorrectionLevel:'M'});access.assert(e.id);
          view={status:'open',message:'모바일 체험이 열려 있습니다.',url:match[0],joinUrl,code:e.code,qr};
        }
      };
      child.stdout.on('data',c=>void collect(c).catch(()=>{}));child.stderr.on('data',c=>void collect(c).catch(()=>{}));
      child.on('error',()=>void stop('외부 연결을 시작하지 못했습니다. 실행 파일과 네트워크를 확인해 주세요.'));
      child.on('exit',()=>{if(access.current?.id===e.id&&e.active)void stop('외부 연결이 끊겨 체험을 종료했습니다. 새로 시작해 주세요.');});
      startingTimer=setTimeout(()=>{if(!published)void stop('주소를 받지 못했습니다. 인터넷 연결을 확인한 뒤 새로 시작해 주세요.');},90000);startingTimer.unref();
    }catch(error){await stop(error.code==='ENOENT'?'연결 프로그램이 없습니다. 최신 Windows 실행용 ZIP을 사용해 주세요.':error.message);throw error;}finally{starting=false;}
    return info();
  }
  function remote(req){
    const secret=req.headers['x-coaster-event-secret'];if(!secret)return null;
    const e=access.assert(req.headers['x-coaster-event']);
    const a=Buffer.from(String(secret)),b=Buffer.from(e.secret);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)||!/^\w[\w-]{35}$/.test(req.headers['x-coaster-participant']||''))throw appError('유효하지 않은 체험 연결입니다.','FORBIDDEN',403);
    return {eventId:e.id,participant:req.headers['x-coaster-participant'],expiresAt:e.expiresAt};
  }
  return {info,start,stop,remote,assert:id=>access.assert(id),take:id=>access.take(id)};
}
