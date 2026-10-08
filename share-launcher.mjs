import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,DATA,readJSON,alive} from './server/common.mjs';
if(process.argv.includes('--stop')){
 const state=await readJSON(path.join(DATA,'server.json'));
 if(state?.root===ROOT&&alive(state.pid)&&/^http:\/\/127\.0\.0\.1:\d+$/.test(state.url)){
  const h=await(await fetch(state.url+'/api/health')).json();
  const r=await fetch(state.url+'/api/event/stop',{method:'POST',headers:{'X-Coaster-Token':h.token}});
  if(!r.ok)throw new Error('체험 종료 실패');
 }
}else await import('./launcher.mjs');
