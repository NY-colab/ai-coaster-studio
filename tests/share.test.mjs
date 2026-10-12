import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGateway} from '../server/share-gateway.mjs';

test('remote gate requires a code, sanitizes health, isolates admin and checks CSRF',async()=>{
  const received=[];
  const backend=http.createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    received.push({url:req.url,token:req.headers['x-coaster-token'],cookie:req.headers.cookie,body});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/health')return res.end(JSON.stringify({ready:true,token:'LOCAL_ADMIN_SECRET',auth:'chatgpt',login:{status:'running',code:'PRIVATE_DEVICE_CODE'},cliVersion:'private',busy:false}));
    res.end(JSON.stringify({ok:true}));
  });
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));
  const gate=createGateway({backend:'http://127.0.0.1:'+backend.address().port,code:'test-event-code',publicOrigin:'http://event.test',secureCookies:false});
  await new Promise(r=>gate.server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+gate.server.address().port;
  const call=(p,opts={})=>new Promise((resolve,reject)=>{const req=http.request(url+p,{method:opts.method||'GET',headers:{Host:'event.test',...opts.headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:{get:k=>Array.isArray(res.headers[k])?res.headers[k].join(';'):res.headers[k]},json:async()=>JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.end(opts.body);});
  try{
    assert.equal((await fetch(url)).status,403,'unknown host rejected');
    const landing=await call('/');assert.equal(landing.status,200);assert.equal(landing.headers.get('referrer-policy'),'same-origin','HTML form POST must preserve same-origin Origin header');
    for(const p of ['/api/health','/api/jobs','/api/photos/123','/assets/main.js'])assert.equal((await call(p)).status,401);
    assert.equal((await call('/enter',{method:'POST',headers:{Origin:'https://evil.test'},body:'code=test-event-code'})).status,403);
    assert.equal((await call('/enter',{method:'POST',headers:{Origin:'http://event.test'},body:'code=wrong'})).status,401);
    const login=await call('/enter',{method:'POST',headers:{Origin:'http://event.test'},body:'code=test-event-code'});
    assert.equal(login.status,303);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const h=await (await call('/api/health',{headers:{Cookie:cookie}})).json();
    assert.equal(h.remote,true);assert.equal(h.cliVersion,null);assert.notEqual(h.token,'LOCAL_ADMIN_SECRET');assert.equal(h.login.code,undefined);
    const headers={Cookie:cookie,Origin:'http://event.test','X-Coaster-Token':h.token};
    for(const p of ['/api/auth/login','/api/auth/check','/api/shutdown','/api/data','/server/index.mjs','/data/share-session.json'])assert.equal((await call(p,{method:'POST',headers})).status,403,p);
    assert.equal((await call('/api/jobs',{method:'POST',headers:{Cookie:cookie,Origin:'http://event.test'},body:'{}'})).status,403);
    assert.equal((await call('/api/jobs',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{}'})).status,403);
    const upload=await call('/api/photos',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:'photo-bytes'});
    assert.equal(upload.status,200);assert.equal(received.at(-1).token,'LOCAL_ADMIN_SECRET');assert.equal(received.at(-1).cookie,undefined);assert.equal(received.at(-1).body,'photo-bytes');
    for(let i=0;i<8;i++)await call('/enter',{method:'POST',headers:{Origin:'http://event.test'},body:'code=bad'});
    assert.equal((await call('/enter',{method:'POST',headers:{Origin:'http://event.test'},body:'code=test-event-code'})).status,429);
  }finally{gate.server.closeAllConnections();await gate.close();backend.closeAllConnections();await new Promise(r=>backend.close(r));}
});
