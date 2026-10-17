import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageLoader} from '../browser/image-loader.mjs';
import {PhotoCache} from '../browser/photo-cache.mjs';
import {pruneDescriptors} from '../browser/descriptor-cache.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=text=>({ok:true,headers:new Headers(),body:new ReadableStream({start(controller){controller.enqueue(Buffer.from(text));controller.close();}})});

test('the default browser fetch retains its global receiver when called by the image loader',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async function(url,options){assert.equal(this,globalThis,'native Worker fetch requires its global receiver');assert.equal(url,'https://img.kwcdn.com/native.jpg');assert.equal(options.credentials,'omit');calls++;return response('native-image');};
  try{const loader=new ImageLoader({allowed:()=>true,decode:async bytes=>bytes});assert.equal((await loader.get('https://img.kwcdn.com/native.jpg')).buffer.toString(),'native-image');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('captured image downloads overlap at most three, deduplicate in-flight work and keep out-of-order bytes bound to their URLs',async()=>{
  const gates=new Map(),calls=[];
  const loader=new ImageLoader({allowed:url=>url.startsWith('https://img.kwcdn.com/'),decode:async bytes=>bytes,decodeData:()=>{throw Error('unused');},fetchImage:(url,options)=>{calls.push({url,options});return new Promise(resolve=>gates.set(url,resolve));}});
  const urls=['a','b','c','d'].map(name=>'https://img.kwcdn.com/'+name+'.jpg');
  const jobs=urls.map(url=>loader.get(url));assert.equal(calls.length,3);assert.equal(loader.get(urls[0]),jobs[0]);
  gates.get(urls[1])(response('b'));assert.equal((await jobs[1]).buffer.toString(),'b');await tick();assert.equal(calls.length,4);
  for(const [i,name] of [[3,'d'],[2,'c'],[0,'a']]){gates.get(urls[i])(response(name));assert.equal((await jobs[i]).buffer.toString(),name);}
  assert.ok(calls.every(call=>call.options.credentials==='omit'&&call.options.redirect==='error'));
});

test('untrusted or oversized images fail without poisoning later downloads or returning cached failures',async()=>{
  let calls=0;
  const loader=new ImageLoader({allowed:url=>url.startsWith('https://img.kwcdn.com/'),decode:async bytes=>bytes,fetchImage:async()=>{calls++;return calls===1?{ok:true,headers:new Headers({'content-length':'8000001'})}:response('valid');}});
  await assert.rejects(loader.get('https://attacker.example/a'),/官方商品图片/);assert.equal(calls,0);
  await assert.rejects(loader.get('https://img.kwcdn.com/a'),/8 MB/);assert.equal((await loader.get('https://img.kwcdn.com/a')).buffer.toString(),'valid');
});

test('photo evidence is shared across phases but cloned for callers and never reused across changed content or same-asset proof',async()=>{
  let calls=0;const cache=new PhotoCache(async value=>{calls++;return {samePhoto:value,evidence:{value}};});
  const [a,b]=await Promise.all([cache.get('reference-A:candidate-A:false',false),cache.get('reference-A:candidate-A:false',false)]);a.evidence.value=true;
  assert.equal(b.evidence.value,false);assert.equal((await cache.get('reference-A:candidate-A:false',false)).samePhoto,false);assert.equal(calls,1);
  assert.equal((await cache.get('reference-B:candidate-A:false',true)).samePhoto,true);await cache.get('reference-A:candidate-A:true',true);assert.equal(calls,3);
});

test('descriptor pruning reads timestamp keys without cloning vectors and retains only the newest 256 valid-age rows',async()=>{
  const now=Date.now(),rows=Array.from({length:300},(_,i)=>({key:now-i,primaryKey:'key-'+i}));rows[299].key=now-31*86400000;
  let position=0;const deleted=[],request={};
  const emit=()=>queueMicrotask(()=>{request.result=position<rows.length?{...rows[position++],get value(){throw Error('vectors must not be read');},continue:emit}:null;request.onsuccess();});
  const store={index:name=>{assert.equal(name,'time');return {openKeyCursor:(range,direction)=>{assert.equal(direction,'prev');emit();return request;}};},delete:key=>deleted.push(key)};
  await pruneDescriptors(store,now);assert.equal(deleted.length,44);assert.equal(deleted[0],'key-256');assert.equal(deleted.at(-1),'key-299');
});
