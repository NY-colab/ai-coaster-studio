import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGateway,WEB_ORIGIN} from '../server/share-gateway.mjs';

test('GitHub web sessions use scoped bearer tokens, strict CORS and immediate revocation',async()=>{
 const received=[];
 const backend=http.createServer(async(req,res)=>{for await(const _ of req){}received.push(req.headers);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/health'?{ready:true,token:'ADMIN',login:{code:'PRIVATE'},operator:{name:'PRIVATE_PC'}}:{ok:true}));});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const gate=createGateway({backend:'http://127.0.0.1:'+backend.address().port,publicOrigin:'http://event.test',code:'event-secret',eventId:'event-id',internalSecret:'internal',backendToken:'ADMIN'});
 await new Promise(r=>gate.server.listen(0,'127.0.0.1',r));
 const call=(url,method='GET',headers={},body)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:gate.server.address().port,path:url,method,headers:{Host:'event.test',Origin:WEB_ORIGIN,...headers}},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:data?JSON.parse(data):null}));});req.on('error',reject);req.end(body);});
 try {
  const pre=await call('/api/photos','OPTIONS',{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-coaster-token'});
  assert.equal(pre.status,204);assert.equal(pre.headers['access-control-allow-origin'],WEB_ORIGIN);assert.equal(pre.headers['access-control-allow-credentials'],undefined);
  assert.equal((await call('/api/photos','OPTIONS',{Origin:'https://evil.test','Access-Control-Request-Method':'POST'})).status,403);
  assert.equal((await call('/api/auth/login','OPTIONS',{'Access-Control-Request-Method':'POST'})).status,403);
  assert.equal((await call('/api/web-session','POST',{},JSON.stringify({code:'wrong'}))).status,401);
  assert.equal((await call('/api/web-session','POST',{Origin:'http://event.test'},JSON.stringify({code:'event-secret'}))).status,403);
  assert.equal((await call('/api/web-session','POST',{},'{bad')).status,400);
  const a=await call('/api/web-session','POST',{},JSON.stringify({code:'event-secret'}));
  const b=await call('/api/web-session','POST',{},JSON.stringify({code:'event-secret'}));
  assert.equal(a.status,200);assert.notEqual(a.data.bearer,b.data.bearer);assert.equal(a.headers['set-cookie'],undefined);
  const ah={Authorization:'Bearer '+a.data.bearer},bh={Authorization:'Bearer '+b.data.bearer};
  const h=await call('/api/health','GET',ah);assert.equal(h.status,200);assert.equal(h.data.remote,true);assert.equal(h.data.operator,undefined);assert.equal(h.data.login.code,undefined);assert.notEqual(h.data.token,'ADMIN');
  const participantA=received.at(-1)['x-coaster-participant'];await call('/api/health','GET',bh);assert.notEqual(received.at(-1)['x-coaster-participant'],participantA);
  assert.equal((await call('/api/photos','POST',ah,'photo')).status,403);
  assert.equal((await call('/api/photos','POST',{...ah,'X-Coaster-Token':h.data.token},'photo')).status,200);
  assert.equal(received.at(-1)['x-coaster-token'],'ADMIN');assert.equal(received.at(-1).authorization,undefined);
  assert.equal((await call('/api/jobs','POST',{...bh,'X-Coaster-Token':h.data.token},'{}')).status,403);
  for(const path of ['/api/auth/login','/api/auth/check','/api/event/start','/api/shutdown','/api/data'])assert.equal((await call(path,'POST',{...ah,'X-Coaster-Token':h.data.token},'{}')).status,403);
  assert.equal((await call('/api/health','GET',{Cookie:'coaster_session='+a.data.bearer})).status,401);
  gate.revoke();const ended=await call('/api/health','GET',ah);assert.equal(ended.status,410);assert.equal(ended.headers['access-control-allow-origin'],WEB_ORIGIN);
  assert.equal((await call('/api/web-session','POST',{},JSON.stringify({code:'event-secret'}))).status,410);
 }finally{gate.server.closeAllConnections();await gate.close();backend.closeAllConnections();await new Promise(r=>backend.close(r));}
});
