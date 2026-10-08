import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGateway} from '../server/share-gateway.mjs';
import {EventAccess} from '../server/events.mjs';

test('gateway revokes existing sessions and rejects a request whose upload crosses event end',async()=>{
  let forwarded=0;
  const backend=http.createServer((req,res)=>{forwarded++;res.end('{}');});
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));
  const access=new EventAccess(),event=access.begin({durationMinutes:1,maxGenerations:1});
  const gate=createGateway({backend:`http://127.0.0.1:${backend.address().port}`,publicOrigin:'http://event.test',code:event.code,secureCookies:false,eventId:event.id,internalSecret:event.secret,backendToken:'test-local',authorize:()=>access.assert(event.id)});
  await new Promise(r=>gate.server.listen(0,'127.0.0.1',r));
  const port=gate.server.address().port;
  const call=(method,url,headers={},body='')=>new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port,path:url,method,headers:{Host:'event.test',Origin:'http://event.test',...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});q.on('error',reject);q.end(body);});
  try{
    const login=await call('POST','/enter',{},'code='+event.code);assert.equal(login.status,303);
    const cookie=login.headers['set-cookie'][0].split(';')[0];
    // Leave the form body incomplete so revocation happens between ingress and dispatch.
    let request;
    const late=new Promise((resolve,reject)=>{request=http.request({host:'127.0.0.1',port,path:'/enter',method:'POST',headers:{Host:'event.test',Origin:'http://event.test','Content-Length':5+event.code.length}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});request.on('error',reject);request.write('code=');});
    await new Promise(r=>setTimeout(r,30));access.revoke();gate.revoke();request.end(event.code);
    assert.equal(await late,410);
    assert.equal((await call('GET','/api/jobs',{Cookie:cookie})).status,410);
    assert.equal((await call('POST','/api/jobs',{Cookie:cookie},'{}')).status,410);
    assert.equal((await call('POST','/enter',{},'code='+event.code)).status,410);
    assert.equal(forwarded,0);
  }finally{gate.server.closeAllConnections();await gate.close();backend.closeAllConnections();await new Promise(r=>backend.close(r));}
});
