import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {threadImage} from '../server/image-output.mjs';
test('missing image paths recover only a single fresh image from the exact execution thread',async()=>{
 const root=path.resolve('work/output-'+randomUUID()),thread=randomUUID(),dir=path.join(root,'generated_images',thread);
 await fs.mkdir(dir,{recursive:true});const start=new Date().toISOString(),file=path.join(dir,'exec-one.png');
 assert.equal(await threadImage(root,'../../other',start),null);
 assert.equal(await threadImage(root,thread,start),null);
 await fs.writeFile(file,'candidate');assert.equal(await threadImage(root,thread,start),file);
 assert.equal(await threadImage(root,randomUUID(),start),null);
 const stale=path.join(dir,'old.png');await fs.writeFile(stale,'old');await fs.utimes(stale,new Date(0),new Date(0));
 assert.equal(await threadImage(root,thread,start),file);
 await fs.writeFile(path.join(dir,'exec-two.png'),'ambiguous');assert.equal(await threadImage(root,thread,start),null);
});
