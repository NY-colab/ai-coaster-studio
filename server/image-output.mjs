import fs from 'node:fs/promises';
import path from 'node:path';
// CLI releases can save the native image but omit its path from the model response.
// Recover only one new regular image from this exact execution thread, never a global latest file.
export async function threadImage(codexHome, thread, createdAt) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(thread || '')) return null;
  const root = path.join(codexHome, 'generated_images', thread);
  const entries = await fs.readdir(root, {withFileTypes:true}).catch(e => { if(e.code==='ENOENT') return []; throw e; });
  const candidates=[];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
    const file=path.join(root,entry.name), stat=await fs.stat(file);
    if (stat.mtimeMs >= Date.parse(createdAt)-10000) candidates.push(file);
  }
  return candidates.length === 1 ? candidates[0] : null;
}
