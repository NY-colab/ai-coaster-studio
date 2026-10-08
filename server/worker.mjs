// Durable subprocess controller: survives a browser/server restart and never resubmits.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { writeJSON, scrubEnv } from './common.mjs';
const config = JSON.parse(await fsp.readFile(process.argv[2], 'utf8'));
const events = fs.openSync(path.join(config.folder, 'events.jsonl'), 'a');
const errors = fs.openSync(path.join(config.folder, 'provider-stderr.log'), 'a');
const args = ['-a','never','--no-daemon','exec','--ignore-user-config','--ephemeral','--disable','apps','--disable','shell_tool','--sandbox','workspace-write','--skip-git-repo-check','--json','-m','gpt-6-sol','-c','model_reasoning_effort="low"','-C',config.folder,'-i',config.inputPath,'--output-schema',path.join(config.folder,'provider-schema.json'),'-o',path.join(config.folder,'provider.json'),'-'];
try {
  if(config.remote){
    let parentAlive=true;try{process.kill(config.parentPid,0);}catch{parentAlive=false;}
    if(Date.now()>=config.remote.expiresAt||!parentAlive||fs.existsSync(path.join(config.folder,'cancel.flag'))){
      await writeJSON(path.join(config.folder,'receipt.json'),{exitCode:-1,error:'EVENT_CLOSED',cancelled:true,finishedAt:new Date().toISOString()});
      fs.closeSync(events);fs.closeSync(errors);process.exit(0);
    }
  }
  const child = spawn(config.cli, args, { windowsHide: true, env: scrubEnv(), stdio: ['pipe',events,errors] });
  let cancellation=false;
  const cancelTimer=config.remote?setInterval(()=>{
    let parentAlive=true;try{process.kill(config.parentPid,0);}catch{parentAlive=false;}
    if(!cancellation&&(Date.now()>=config.remote.expiresAt||!parentAlive||fs.existsSync(path.join(config.folder,'cancel.flag')))){
      cancellation=true;
      if(process.platform==='win32')execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
      else child.kill('SIGTERM');
    }
  },250):null;
  child.on('error', async e => { await writeJSON(path.join(config.folder,'receipt.json'), { exitCode: -1, error: e.code || 'SPAWN_FAILED', finishedAt: new Date().toISOString() }); process.exitCode = 1; });
  child.on('spawn', async () => { await writeJSON(path.join(config.folder,'process.json'), { runnerPid: process.pid, cliPid: child.pid, startedAt: new Date().toISOString() }); child.stdin.end(config.prompt); });
  child.stdin.on('error', () => {});
  child.on('close', async (code, signal) => { clearInterval(cancelTimer);await writeJSON(path.join(config.folder,'receipt.json'), { exitCode: code, signal, cancelled:cancellation, finishedAt: new Date().toISOString() }); fs.closeSync(events); fs.closeSync(errors); });
} catch (e) { await writeJSON(path.join(config.folder,'receipt.json'), { exitCode: -1, error: e.code || 'SPAWN_FAILED', finishedAt: new Date().toISOString() }); }
