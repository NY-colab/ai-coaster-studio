import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(process.env.COASTER_DATA_DIR || path.join(ROOT, 'data'));
export const CODEX_HOME_DIR = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
export const VERSION = '1.4.1';
export const DEFAULT_EDIT = { shape: 'circle', sizeMm: 90, zoom: 1, x: 0, y: 0, rotation: 0 };
export const STYLES = {
  watercolor: 'A delicate hand-painted watercolor portrait, airy washes, subtle watercolor paper, warm peach and sage accents.',
  crayon: 'An original colorful crayon portrait, joyful wax strokes, soft imperfect outlines, warm pastel colors and a handmade storybook feeling.',
  caricature: 'An affectionate illustrated caricature, recognizable facial features, slightly larger head and expressive eyes, gentle exaggeration, polished clean outlines and warm pastel colors.'
};
export const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function appError(message, code = 'INVALID_REQUEST', statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function validId(id) { if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw appError('올바르지 않은 작업 번호입니다.'); return id; }
export const inside = (root, candidate) => { const rel = path.relative(root, candidate); return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
export async function readJSON(file, fallback = null) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
export async function writeJSON(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + crypto.randomUUID(); await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8'); await fs.rename(tmp, file); }
export function validateEdit(raw = DEFAULT_EDIT) {
  const value = { ...DEFAULT_EDIT, ...raw };
  if (!['circle', 'square'].includes(value.shape)) throw appError('원형 또는 사각형을 선택해 주세요.');
  for (const [key, min, max] of [['sizeMm',40,120],['zoom',0.5,3],['x',-1,1],['y',-1,1],['rotation',-180,180]]) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw appError('편집 범위를 벗어났습니다: ' + key);
  }
  return Object.fromEntries(Object.keys(DEFAULT_EDIT).map(k => [k,value[k]]));
}
export function scrubEnv(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CODEX_THREAD|CODEX_TASK|CODEX_INTERNAL|OPENAI_BASE_URL|CODEX_BASE_URL/i.test(key)) delete env[key];
  env.CODEX_HOME = CODEX_HOME_DIR;
  return env;
}
export function generationPrompt(style) {
  return `Use ONLY the built-in image generation tool to transform the attached photograph into exactly one square portrait illustration for a 9 cm ceramic coaster. ${STYLES[style]} Preserve the person's recognizable face, hairstyle, skin tone, clothing and expression. Center the head and shoulders and leave generous clear margins around the hair and face, keeping important features within the central 80% for a circular crop. Use a simple warm cream background. No words, logos, watermark, text labels, circular border, coaster mockup or extra people. Generate exactly one real raster image. Do not use external APIs, API keys, web research, browser automation, shell commands or delegate. Return the ACTUAL local path supplied by the native generation tool in image_path. Do not invent a path or simulate generation. If the native tool is unavailable return status unavailable. Return JSON only with status (success/unavailable/failed), image_path (string or null), and error (string or null).`;
}
