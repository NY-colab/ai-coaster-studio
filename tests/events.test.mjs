import test from 'node:test';
import assert from 'node:assert/strict';
import {EventAccess} from '../server/events.mjs';

test('expiry/revocation invalidate old event capability and quota cannot exceed cap',t=>{
  t.mock.timers.enable({apis:['Date'],now:1000});
  const a=new EventAccess();const e=a.begin({durationMinutes:1,maxGenerations:2});
  a.take(e.id);a.take(e.id);assert.equal(e.used,2);assert.throws(()=>a.take(e.id),{code:'EVENT_LIMIT'});
  t.mock.timers.tick(60000);assert.throws(()=>a.assert(e.id),{code:'EVENT_CLOSED'});
  a.revoke();const next=a.begin();assert.notEqual(next.id,e.id);assert.notEqual(next.secret,e.secret);
  assert.throws(()=>a.assert(e.id),{code:'EVENT_CLOSED'});a.revoke();assert.throws(()=>a.take(next.id),{code:'EVENT_CLOSED'});
});
test('event limits reject malformed values and cannot open two events',()=>{
  const a=new EventAccess();for(const durationMinutes of [0,721,NaN,'60'])assert.throws(()=>a.begin({durationMinutes}));
  a.begin();assert.throws(()=>a.begin(),{code:'EVENT_BUSY'});
});
