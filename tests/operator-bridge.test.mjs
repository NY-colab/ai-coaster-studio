import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {installOperatorBridge,OPERATOR_ORIGIN} from '../server/operator-bridge.mjs';

test('operator pairing requires local confirmation, is one-use, scoped to each PC, expires and revokes',async()=>{
 let now=1000;
 const setup=async()=>{const app=Fastify();installOperatorBridge(app,{token:'local-csrf',backend:()=> 'http://127.0.0.1:4318',now:()=>now});app.get('/api/private',req=>({operator:!!req.operatorWeb}));await app.ready();return app;};
 const a=await setup(),b=await setup();
 const call=(app,url,method='GET',headers={},payload)=>app.inject({url,method,headers:{host:'127.0.0.1:4318',...headers},payload});
 const origin={origin:OPERATOR_ORIGIN};
 const pair=async()=>{const r=await call(a,'/web-operator','POST',{origin:'http://127.0.0.1:4318','content-type':'application/x-www-form-urlencoded'},'token=local-csrf');assert.equal(r.statusCode,303);const link=new URL(r.headers.location);assert.equal(link.origin,OPERATOR_ORIGIN);return new URLSearchParams(link.hash.slice(1)).get('pair');};
 try {
  assert.equal((await call(a,'/api/private','GET',origin)).statusCode,401);
  assert.equal((await call(a,'/api/private','GET',{...origin,host:'evil.test:4318'})).statusCode,403);
  const pre=await call(a,'/api/private','OPTIONS',{...origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'});
  assert.equal(pre.statusCode,204);assert.equal(pre.headers['access-control-allow-origin'],OPERATOR_ORIGIN);assert.equal(pre.headers['access-control-allow-private-network'],'true');
  assert.equal((await call(a,'/web-operator','POST',{origin:'https://evil.test'},{token:'local-csrf'})).statusCode,403);
  assert.equal((await call(a,'/web-operator','POST',{origin:'http://127.0.0.1:4318'},{token:'wrong'})).statusCode,403);
  const code=await pair();
  assert.equal((await call(a,'/api/operator-session','POST',{origin:'https://evil.test'},{code})).statusCode,403);
  const session=await call(a,'/api/operator-session','POST',origin,{code});assert.equal(session.statusCode,200);
  assert.equal((await call(a,'/api/operator-session','POST',origin,{code})).statusCode,401);
  const auth={...origin,authorization:'Bearer '+session.json().bearer};
  assert.equal((await call(a,'/api/private','GET',auth)).json().operator,true);
  assert.equal((await call(b,'/api/private','GET',auth)).statusCode,401,'different PC rejects operator bearer');
  assert.equal((await call(a,'/api/private','GET',{...auth,'x-coaster-participant':'participant'})).statusCode,403);
  assert.equal((await call(a,'/api/operator-session','DELETE',auth)).statusCode,200);
  assert.equal((await call(a,'/api/private','GET',auth)).statusCode,401);
  const expired=await pair();now+=120001;
  assert.equal((await call(a,'/api/operator-session','POST',origin,{code:expired})).statusCode,401);
  const fresh=await call(a,'/api/operator-session','POST',origin,{code:await pair()});
  now+=12*3600000+1;
  assert.equal((await call(a,'/api/private','GET',{...origin,authorization:'Bearer '+fresh.json().bearer})).statusCode,401);
 }finally{await a.close();await b.close();}
});
