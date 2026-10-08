// Explicit test-only Node loader: no real Codex process or tunnel is started.
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
 if(url.endsWith('/server/codex.mjs'))return {format:'module',shortCircuit:true,source:`
 import fs from 'node:fs/promises';import path from 'node:path';
 export const loginState={status:'idle'};
 export async function diagnose(){return {ready:true,auth:'chatgpt',message:'test'};}
 export async function startLogin(){return loginState;}
 export async function startWorker(job,folder,input,authorize){await new Promise(r=>setTimeout(r,100));authorize();await fs.appendFile(path.join(process.env.COASTER_DATA_DIR,'test-launches'),'launched\\n');return null;}
 `};
 if(url.endsWith('/server/events.mjs'))return {format:'module',shortCircuit:true,source:`
 import {EventAccess} from ${JSON.stringify(url+'?actual')};
 export function createEventManager({onStop}){const a=new EventAccess();return {
 info:()=>({active:!!a.current?.active,eventId:a.current?.id,used:a.current?.used}),
 start:o=>a.begin(o),stop:async()=>{const id=a.current?.id;a.revoke();if(id)await onStop(id);},
 remote:req=>{if(!req.headers['x-coaster-event-secret'])return null;const e=a.assert(req.headers['x-coaster-event']);if(req.headers['x-coaster-event-secret']!==e.secret)throw Object.assign(new Error('secret'),{statusCode:403});return {eventId:e.id,participant:req.headers['x-coaster-participant'],expiresAt:e.expiresAt};},
 assert:id=>a.assert(id),take:id=>a.take(id)};}
 `};
 return next(url,context);
}});
