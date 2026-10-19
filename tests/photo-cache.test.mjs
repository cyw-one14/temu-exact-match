import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoCache} from '../server/photo-cache.mjs';
test('photo evidence is shared across phases but cloned for callers and never reused across changed content or same-asset proof',async()=>{
  let calls=0;const cache=new PhotoCache(async value=>{calls++;return {samePhoto:value,evidence:{value}};});
  const [a,b]=await Promise.all([cache.get('reference-A:candidate-A:false',false),cache.get('reference-A:candidate-A:false',false)]);a.evidence.value=true;
  assert.equal(b.evidence.value,false);assert.equal((await cache.get('reference-A:candidate-A:false',false)).samePhoto,false);assert.equal(calls,1);
  assert.equal((await cache.get('reference-B:candidate-A:false',true)).samePhoto,true);await cache.get('reference-A:candidate-A:true',true);assert.equal(calls,3);
});

