import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {createEventManager} from './events.mjs';
import {latestRelease} from './updates.mjs';
import sharp from 'sharp';
import { ROOT,DATA,VERSION,CODEX_HOME_DIR,DEFAULT_EDIT,STYLES,alive,inside,appError,validId,readJSON,writeJSON,validateEdit } from './common.mjs';
import { diagnose,startWorker,startLogin,loginState } from './codex.mjs';
import { renderPNG,renderPDF,calibrationPDF } from './export.mjs';
await fs.mkdir(DATA,{recursive:true});
const lockFile=path.join(DATA,'server.lock');
try { const h=await fs.open(lockFile,'wx'); await h.writeFile(String(process.pid)); await h.close(); }
catch(e) { if(e.code!=='EEXIST')throw e; const pid=Number(await fs.readFile(lockFile,'utf8')); if(alive(pid))throw new Error('이 폴더의 앱이 이미 실행 중입니다.'); await fs.unlink(lockFile); const h=await fs.open(lockFile,'wx'); await h.writeFile(String(process.pid)); await h.close(); }
const app=Fastify({logger:false,bodyLimit:1024*1024});
const token=crypto.randomBytes(32).toString('hex');
let url;
const eventManager=createEventManager({backend:()=>url,backendToken:token,onStop:async eventId=>{for(const job of jobs.values())if(job.remote?.eventId===eventId&&['queued','running'].includes(job.status)){await fs.mkdir(folder(job.id),{recursive:true});await fs.writeFile(path.join(folder(job.id),'cancel.flag'),'Event closed');job.status='failed';job.errorCode='EVENT_CLOSED';job.error='체험이 종료되어 생성 중단을 요청했습니다. 이미 사용된 할당량은 되돌릴 수 없습니다.';job.stage='체험 종료';await save(job);}}});
let activeJob=null, healthCache=null, healthTime=0, generation='untested';
const jobs=new Map();
for(const dir of await fs.readdir(path.join(DATA,'jobs')).catch(()=>[])) { const job=await readJSON(path.join(DATA,'jobs',dir,'job.json')); if(job)jobs.set(job.id,job); }
const folder=id=>path.join(DATA,'jobs',validId(id));
const save=async job=>{job.updatedAt=new Date().toISOString(); jobs.set(job.id,job);await writeJSON(path.join(folder(job.id),'job.json'),job);};
const publicJob=job=>{const {runnerPid,remote,...safe}=job;return safe;};
const busy=()=>[...jobs.values()].some(j=>['queued','running'].includes(j.status)||(j.errorCode==='EVENT_CLOSED'&&j.runnerPid&&alive(j.runnerPid)));
async function refreshJob(job) {
  if(!['queued','running'].includes(job.status))return;
  const dir=folder(job.id), receipt=await readJSON(path.join(dir,'receipt.json'));
  const events=await fs.readFile(path.join(dir,'events.jsonl'),'utf8').catch(()=> '');
  for(const line of events.split(/\r?\n/))try {const event=JSON.parse(line);if(event.type==='thread.started')job.providerThread=event.thread_id;}catch{}
  if(!receipt) {
    const proc=await readJSON(path.join(dir,'process.json'));
    const pid=proc?.runnerPid||job.runnerPid;
    if(pid&&alive(pid)){job.stage=job.providerThread?'그림을 생성하고 있습니다':'Codex에 연결하고 있습니다';await save(job);return;}
    if(Date.now()-Date.parse(job.createdAt)<15000)return;
    job.status='interrupted';job.stage='실행 상태를 확인할 수 없습니다';job.errorCode='INTERRUPTED';job.error='이전 실행이 중단되었습니다. 자동 재제출하지 않았습니다. 결과를 확인한 뒤 새로 생성해 주세요.'; await save(job);return;
  }
  try {
    const result=await readJSON(path.join(dir,'provider.json'));
    if(receipt.exitCode!==0||result?.status!=='success'||!result?.image_path) {
      const log=(await fs.readFile(path.join(dir,'provider-stderr.log'),'utf8').catch(()=>''))+' '+events+' '+(result?.error||'');
      if(result?.status==='unavailable'||/unavailable|unsupported tool/i.test(log)){generation='unavailable';throw appError('현재 Codex 계정에서 내장 이미지 생성 도구를 사용할 수 없습니다. Codex 업데이트와 계정 도구 사용 가능 여부를 확인해 주세요.','IMAGE_TOOL_UNAVAILABLE');}
      if(/rate.limit|usage.limit|quota|limit reached/i.test(log))throw appError('Codex 사용 한도에 도달했습니다. 한도가 회복된 후 다시 시도해 주세요.','RATE_LIMIT');
      if(/unauth|401|login|token expired/i.test(log))throw appError('로그인이 만료되었습니다. 연결 설정에서 다시 로그인해 주세요.','AUTH_EXPIRED');
      if(/network|connect|timeout|timed.out/i.test(log))throw appError('네트워크 연결로 인해 완료를 확인하지 못했습니다. 자동 재제출하지 않았습니다.','CONNECTION_FAILED');
      throw appError('이미지 생성이 완료되지 않았습니다. 이전 결과는 보존되어 있습니다.','GENERATION_FAILED');
    }
    const candidate=await fs.realpath(path.normalize(result.image_path));
    const cache=await fs.realpath(path.join(CODEX_HOME_DIR,'generated_images'));
    const own=await fs.realpath(dir);
    if(!inside(cache,candidate)&&!inside(own,candidate))throw appError('생성 파일 경로를 검증하지 못했습니다.','OUTPUT_INVALID');
    if(job.providerThread&&inside(cache,candidate)&&!inside(path.join(cache,job.providerThread),candidate))throw appError('다른 작업의 결과 이미지가 반환되어 사용하지 않았습니다.','OUTPUT_INVALID');
    const st=await fs.stat(candidate);if(st.size<1000||st.size>30*1024*1024||st.mtimeMs<Date.parse(job.createdAt)-10000)throw appError('생성 파일을 검증하지 못했습니다.','OUTPUT_INVALID');
    const meta=await sharp(candidate,{limitInputPixels:36000000}).metadata();if(!['png','jpeg','webp'].includes(meta.format)||meta.width<256||meta.height<256)throw appError('유효한 생성 이미지가 아닙니다.','OUTPUT_INVALID');
    await sharp(candidate).rotate().resize(1536,1536,{fit:'contain',background:'#fffaf0'}).png().toFile(path.join(dir,'result.png'));
    if(job.errorCode==='EVENT_CLOSED')return;
    job.status='succeeded';job.stage='그림 완성';job.imageUrl='/api/jobs/'+job.id+'/image';generation='verified';await save(job);
  } catch(e) {if(job.errorCode==='EVENT_CLOSED')return;job.status='failed';job.stage='생성 완료를 확인하지 못했습니다';job.error=e.message;job.errorCode=e.code||'OUTPUT_INVALID';await save(job);}
}
let refreshing=false;
async function refreshAll(){if(refreshing)return;refreshing=true;try{for(const job of jobs.values())await refreshJob(job);activeJob=[...jobs.values()].find(j=>['queued','running'].includes(j.status))?.id||null;}finally{refreshing=false;}}
// Remote work never resumes admission after a server restart.
for(const job of jobs.values())if(job.remote&&['queued','running'].includes(job.status)){await fs.writeFile(path.join(folder(job.id),'cancel.flag'),'Server restarted');job.status='failed';job.errorCode='EVENT_CLOSED';job.error='서버가 재시작되어 이전 모바일 체험이 종료되었습니다.';await save(job);}
await refreshAll();
const timer=setInterval(()=>refreshAll().catch(()=>{}),1500);timer.unref();
app.addHook('onRequest',async(req,reply)=>{
  req.remote=eventManager.remote(req);
  const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw appError('허용되지 않은 호스트입니다.','FORBIDDEN',403);
  const origin=req.headers.origin;if(origin&&origin!=='http://'+host)throw appError('허용되지 않은 요청입니다.','FORBIDDEN',403);
  reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
  if(!['GET','HEAD'].includes(req.method)&&req.headers['x-coaster-token']!==token)throw appError('앱을 새로고침한 뒤 다시 시도해 주세요.','FORBIDDEN',403);
});
app.setErrorHandler((error,req,reply)=>reply.code(error.statusCode||500).send({error:error.statusCode?error.message:'처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',code:error.code||'INTERNAL_ERROR'}));
await app.register(multipart,{limits:{fileSize:15*1024*1024,files:1}});
app.get('/api/ping',async()=>({app:'coaster-studio',version:VERSION}));
async function getHealth(req,force=false){if(force||!healthCache||Date.now()-healthTime>10000||(loginState.status==='complete'&&!healthCache.ready)){healthCache=await diagnose();healthTime=Date.now();}return {...healthCache,busy:busy(),activeJobId:activeJob,login:loginState,token,imageGeneration:generation,version:VERSION,...(req.remote?{}:{operator:{name:os.hostname(),platform:process.platform,arch:process.arch}})};}
app.get('/api/health',req=>getHealth(req));
const localOnly=req=>{if(req.remote)throw appError('운영자 PC에서만 사용할 수 있습니다.','OPERATOR_ONLY',403);};
const owns=(req,remote)=>!req.remote||(remote?.eventId===req.remote.eventId&&remote?.participant===req.remote.participant);
const ownJob=(req,id)=>{const job=jobs.get(validId(id));if(!job||!owns(req,job.remote))throw appError('작품을 찾을 수 없습니다.','NOT_FOUND',404);return job;};
const ownPhoto=async(req,id)=>{validId(id);if(req.remote&&!owns(req,await readJSON(path.join(DATA,'photos',id+'.json'))))throw appError('사진을 찾을 수 없습니다.','NOT_FOUND',404);};
const assertRemote=req=>{if(req.remote)eventManager.assert(req.remote.eventId);};
app.get('/api/event',async req=>{localOnly(req);return eventManager.info();});
app.post('/api/event/start',async req=>{localOnly(req);if(loginState.status==='running')throw appError('로그인을 완료한 뒤 체험을 시작해 주세요.','LOGIN_PENDING',409);const h=await diagnose();if(!h.ready)throw appError(h.message,'AUTH_REQUIRED',503);return eventManager.start(req.body||{});});
app.post('/api/event/stop',async req=>{localOnly(req);await eventManager.stop();return eventManager.info();});
app.get('/api/updates',async req=>{localOnly(req);return latestRelease();});
app.post('/api/auth/check',async req=>{localOnly(req);return getHealth(req,true);});
app.post('/api/auth/login',async req=>{localOnly(req);if(busy()||eventManager.info().active)throw appError('그림 생성 또는 모바일 체험 중에는 로그인 설정을 바꿀 수 없습니다.','BUSY',409);healthCache=null;return {login:await startLogin()};});
app.post('/api/photos',async req=>{
  const part=await req.file();if(!part)throw appError('사진을 선택해 주세요.');
  if(!['image/png','image/jpeg'].includes(part.mimetype))throw appError('JPG 또는 PNG 사진만 업로드할 수 있습니다.');
  const bytes=await part.toBuffer();if(part.file.truncated)throw appError('사진은 15MB 이하로 선택해 주세요.');
  let meta;try{meta=await sharp(bytes,{limitInputPixels:36000000}).metadata();}catch{throw appError('사진을 읽을 수 없습니다. 다른 JPG 또는 PNG를 선택해 주세요.');}
  if(!['png','jpeg'].includes(meta.format))throw appError('JPG 또는 PNG 사진만 업로드할 수 있습니다.');
  const id=crypto.randomUUID(),dir=path.join(DATA,'photos');await fs.mkdir(dir,{recursive:true});
  const data=await sharp(bytes).rotate().resize(2048,2048,{fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer({resolveWithObject:true});
  assertRemote(req);await fs.writeFile(path.join(dir,id+'.jpg'),data.data);if(req.remote)await writeJSON(path.join(dir,id+'.json'),req.remote);return {id,url:'/api/photos/'+id,width:data.info.width,height:data.info.height};
});
app.get('/api/photos/:id',async(req,reply)=>{await ownPhoto(req,req.params.id);const file=path.join(DATA,'photos',validId(req.params.id)+'.jpg');const data=await fs.readFile(file).catch(()=>{throw appError('사진을 찾을 수 없습니다.','NOT_FOUND',404);});return reply.type('image/jpeg').send(data);});
app.post('/api/jobs',async req=>{
  const {photoId,style,requestId}=req.body||{};validId(photoId);validId(requestId);if(!STYLES[style])throw appError('그림 스타일을 선택해 주세요.');
  await ownPhoto(req,photoId);assertRemote(req);
  const existing=[...jobs.values()].find(j=>j.requestId===requestId&&owns(req,j.remote));if(existing)return {job:publicJob(existing)};
  if(loginState.status==='running')throw appError('로그인을 완료한 뒤 그림을 만들어 주세요.','LOGIN_PENDING',409);
  if(busy())throw appError('다른 그림을 생성 중입니다. 완료된 뒤 다시 시도해 주세요.','BUSY',409);
  // Reserve before asynchronous auth checks to prevent simultaneous submissions.
  const job={remote:req.remote||undefined,id:crypto.randomUUID(),requestId,photoId,style,status:'queued',stage:'연결을 확인하고 있습니다',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),photoUrl:'/api/photos/'+photoId,edit:{...DEFAULT_EDIT}};
  jobs.set(job.id,job);activeJob=job.id;
  try{const health=await diagnose();assertRemote(req);if(!health.ready)throw appError(health.message,'AUTH_REQUIRED',503);const input=path.join(DATA,'photos',photoId+'.jpg');await fs.access(input);await fs.mkdir(folder(job.id),{recursive:true});await fs.copyFile(input,path.join(folder(job.id),'input.jpg'));job.startedAt=new Date().toISOString();job.status='running';job.stage='Codex에 연결하고 있습니다';await save(job);job.runnerPid=await startWorker(job,folder(job.id),path.join(folder(job.id),'input.jpg'),()=>{assertRemote(req);if(req.remote)eventManager.take(req.remote.eventId);});await save(job);return {job:publicJob(job)};}
  catch(e){jobs.delete(job.id);activeJob=null;await fs.rm(folder(job.id),{recursive:true,force:true});if(e.code==='ENOENT')throw appError('사진을 찾을 수 없습니다. 다시 업로드해 주세요.');throw e;}
});
app.get('/api/jobs',async req=>({jobs:[...jobs.values()].filter(j=>owns(req,j.remote)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicJob)}));
app.get('/api/jobs/:id',async req=>{const job=ownJob(req,req.params.id);if(!job)throw appError('작업을 찾을 수 없습니다.','NOT_FOUND',404);return {job:publicJob(job)};});
app.get('/api/jobs/:id/image',async(req,reply)=>{const job=ownJob(req,req.params.id);if(job?.status!=='succeeded')throw appError('완성된 이미지가 없습니다.','NOT_FOUND',404);return reply.type('image/png').send(await fs.readFile(path.join(folder(job.id),'result.png')));});
app.patch('/api/jobs/:id/edit',async req=>{const job=ownJob(req,req.params.id);if(job?.status!=='succeeded')throw appError('완성된 그림을 선택해 주세요.');job.edit=validateEdit(req.body?.edit);await save(job);return {job:publicJob(job)};});
app.post('/api/export',async(req,reply)=>{
  const {format,items}=req.body||{};if(!['png','pdf'].includes(format)||!Array.isArray(items)||!items.length||items.length>30)throw appError('출력할 그림을 선택해 주세요.');
  const prepared=[];for(const item of items){const job=ownJob(req,item.jobId);if(job?.status!=='succeeded')throw appError('완성된 그림만 출력할 수 있습니다.');prepared.push({image:path.join(folder(job.id),'result.png'),edit:validateEdit(item.edit||job.edit),copies:item.copies??1});}
  const bytes=format==='png'?await renderPNG(prepared[0].image,prepared[0].edit):await renderPDF(prepared);
  const name='coaster-'+Date.now()+'.'+format,dir=path.join(DATA,'exports');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,name),bytes);
  return reply.header('Content-Disposition',`inline; filename="${name}"`).type(format==='png'?'image/png':'application/pdf').send(bytes);
});
app.get('/api/calibration.pdf',async(req,reply)=>reply.type('application/pdf').header('Content-Disposition','inline; filename="calibration-90mm.pdf"').send(await calibrationPDF()));
app.delete('/api/data',async req=>{localOnly(req);if(busy()||eventManager.info().active)throw appError('그림 생성 완료 후 삭제해 주세요.','BUSY',409);if(req.body?.confirm!=='DELETE')throw appError('삭제 확인이 필요합니다.');for(const name of ['photos','jobs','exports'])await fs.rm(path.join(DATA,name),{recursive:true,force:true});jobs.clear();return {ok:true};});
app.post('/api/shutdown',async(req,reply)=>{localOnly(req);if(busy()||loginState.status==='running')throw appError('생성 또는 로그인 완료 후 종료해 주세요.','BUSY',409);setTimeout(async()=>{await eventManager.stop('앱이 종료되었습니다.');await app.close();await fs.unlink(lockFile).catch(()=>{});process.exit(0);},500);return {ok:true};});
if(await fs.stat(path.join(ROOT,'dist')).catch(()=>null))await app.register(staticFiles,{root:path.join(ROOT,'dist'),prefix:'/'});
app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'찾을 수 없습니다.',code:'NOT_FOUND'}):reply.sendFile('index.html'));
const base=process.env.COASTER_PORT!==undefined?Number(process.env.COASTER_PORT):4318;
for(let n=0;n<11;n++){try{url=await app.listen({host:'127.0.0.1',port:base===0?0:base+n});break;}catch(e){if(e.code!=='EADDRINUSE'||n===10)throw e;}}
await writeJSON(path.join(DATA,'server.json'),{pid:process.pid,url,root:ROOT});
console.log('COASTER_URL='+url);process.send?.({type:'ready',url});
async function stop(){clearInterval(timer);await eventManager.stop('앱이 종료되었습니다.');await app.close();await fs.unlink(lockFile).catch(()=>{});process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
