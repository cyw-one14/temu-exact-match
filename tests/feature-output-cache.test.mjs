import test from 'node:test';
import assert from 'node:assert/strict';
import {FeatureOutputCache} from '../server/feature-output-cache.mjs';

const output=value=>({last_hidden_state:{data:new Float32Array([value,value+1]),dims:[1,1,2]}});
test('identical feature inputs share in-flight tensors while changed pixels compute independently',async()=>{
  const cache=new FeatureOutputCache();let release,calls=0;
  const compute=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const a=cache.get(Buffer.from('same normalized image'),compute),b=cache.get(Buffer.from('same normalized image'),compute);
  await Promise.resolve();assert.equal(calls,1);release(output(2));
  assert.strictEqual(await a,await b);
  await cache.get(Buffer.from('different normalized image'),()=>{calls++;return output(9);});
  assert.equal(calls,2);assert.strictEqual(await cache.get(Buffer.from('same normalized image'),()=>assert.fail()),await a);
});
test('tensor cache enforces LRU/byte limits and retries failed inference without a cached verdict',async()=>{
  const cache=new FeatureOutputCache({capacity:2,maxBytes:16});
  for(const value of [1,2])await cache.get(String(value),()=>output(value));
  await cache.get('1',()=>assert.fail());await cache.get('3',()=>output(3));
  assert.equal(cache.rows.size,2);assert.equal(cache.bytes,16);let calls=0;
  await cache.get('2',()=>{calls++;return output(2);});assert.equal(calls,1);
  const large=new FeatureOutputCache({maxBytes:4});await large.get('large',()=>output(1));assert.equal(large.rows.size,0);assert.equal(large.bytes,0);
  await assert.rejects(cache.get('failure',()=>{throw Error('synthetic inference failure');}),/inference failure/);
  assert.equal((await cache.get('failure',()=>output(5))).last_hidden_state.data[0],5);
});
