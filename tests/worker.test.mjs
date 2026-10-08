import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('remote worker does not launch CLI when expired, cancelled, or parent missing',async()=>{
 const base=path.join(root,'work','worker-test-'+randomUUID());await fs.mkdir(base,{recursive:true});
 try{for(const condition of ['expired','cancelled','orphan']){
  const folder=path.join(base,condition);await fs.mkdir(folder);
  const config={folder,cli:path.join(folder,'MUST-NOT-RUN.exe'),parentPid:condition==='orphan'?2147483647:process.pid,remote:{expiresAt:Date.now()+(condition==='expired'?-1:60000)}};
  if(condition==='cancelled')await fs.writeFile(path.join(folder,'cancel.flag'),'stop');
  const file=path.join(folder,'worker.json');await fs.writeFile(file,JSON.stringify(config));
  const child=spawn(process.execPath,[path.join(root,'server/worker.mjs'),file],{windowsHide:true,stdio:'ignore'});
  assert.equal(await new Promise(r=>child.on('exit',r)),0);
  const receipt=JSON.parse(await fs.readFile(path.join(folder,'receipt.json'),'utf8'));
  assert.equal(receipt.error,'EVENT_CLOSED');assert.equal(receipt.cancelled,true);
 }}finally{assert.ok(base.startsWith(path.join(root,'work')+path.sep));await fs.rm(base,{recursive:true,force:true});}
});
