import test from 'node:test';
import assert from 'node:assert/strict';
import {generationError} from '../server/generation-error.mjs';

test('actual logo refusal is actionable without leaking provider details',()=>{
  const error='The supplied image is a logo with no person, so a portrait preserving a recognizable face, hairstyle, clothing, and expression could not be created.';
  const result=generationError({status:'failed',image_path:null,error});
  assert.equal(result.code,'SUBJECT_MISMATCH');
  assert.match(result.message,/로고·사물/);
  assert.match(result.message,/업데이트/);
  assert.doesNotMatch(result.message,/The supplied/);
});
test('failures distinguish account, service, output and unknown failures safely',()=>{
  for(const [error,code] of [['quota exceeded','RATE_LIMIT'],['token expired','AUTH_EXPIRED'],['network connection timed out','CONNECTION_FAILED'],['The native image tool did not provide a local file path.','OUTPUT_MISSING'],['content policy violation','CONTENT_REJECTED'],['Unknown failure at C:/private/account.json','GENERATION_FAILED']]) {
    const result=generationError({status:'failed',error});assert.equal(result.code,code);assert.doesNotMatch(result.message,/private|account.json/);
  }
  assert.equal(generationError({status:'unavailable',error:null}).code,'IMAGE_TOOL_UNAVAILABLE');
  assert.equal(generationError({status:'failed',error:'The requested background is unavailable'}).code,'GENERATION_FAILED');
});
