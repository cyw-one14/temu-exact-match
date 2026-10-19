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

test('feature tensor sharing survives one cancellation, but all cancellations release queued inference without poisoning a new consumer',async()=>{
  const cache=new FeatureOutputCache(),a=new AbortController();let release,signal,calls=0;
  const compute=internal=>{calls++;signal=internal;return new Promise(resolve=>{release=resolve;});};
  const first=cache.get('shared',compute,{signal:a.signal}),second=cache.get('shared',compute);await Promise.resolve();
  const rejected=assert.rejects(first,{name:'AbortError'});a.abort();await rejected;assert.equal(signal.aborted,false);release(output(1));await second;assert.equal(calls,1);
  const b=new AbortController(),old=cache.get('replacement',compute,{signal:b.signal});await Promise.resolve();const oldRelease=release;
  const oldRejected=assert.rejects(old,{name:'AbortError'});b.abort();await oldRejected;assert.equal(signal.aborted,true);
  const next=cache.get('replacement',compute);await Promise.resolve();const nextRelease=release;oldRelease(output(2));nextRelease(output(3));
  assert.equal((await next).last_hidden_state.data[0],3);assert.equal((await cache.get('replacement',()=>assert.fail())).last_hidden_state.data[0],3);
});
