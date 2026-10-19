import test from 'node:test';import assert from 'node:assert/strict';
import {WorkQueue,SharedWork} from '../server/parallel-work.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('three entries overlap, a fourth waits, and cancelled queued work never enters',async()=>{
  const queue=new WorkQueue(3),entered=[],release=[];
  const tasks=[0,1,2].map(i=>queue.run(()=>{entered.push(i);return new Promise(resolve=>release.push(resolve));}));
  const abort=new AbortController(),fourth=queue.run(()=>assert.fail('cancelled queued work ran'),{signal:abort.signal});
  const rejected=assert.rejects(fourth,{name:'AbortError'});abort.abort();await rejected;await tick();assert.deepEqual(entered,[0,1,2]);assert.equal(queue.active,3);
  const fifth=queue.run(()=>entered.push(4));release[1]();await fifth;assert.deepEqual(entered,[0,1,2,4]);release[0]();release[2]();await Promise.all(tasks);
});
test('shared reference work runs once and one caller cancelling preserves the other caller',async()=>{
  const work=new SharedWork(),abort=new AbortController();let calls=0,release,sharedSignal;
  const compute=signal=>{calls++;sharedSignal=signal;return new Promise(resolve=>{release=resolve;});};
  const a=work.get('reference',compute,{signal:abort.signal}),b=work.get('reference',compute);await tick();
  const rejected=assert.rejects(a,{name:'AbortError'});abort.abort();await rejected;assert.equal(sharedSignal.aborted,false);release('features');assert.equal(await b,'features');assert.equal(calls,1);
});
test('all consumers cancelling aborts subsequent stages and an old result cannot remove replacement work',async()=>{
  const work=new SharedWork(),abort=new AbortController();let releaseOld,releaseNew,oldSignal,calls=0;
  const first=work.get('image',signal=>{oldSignal=signal;return new Promise(resolve=>{releaseOld=resolve;});},{signal:abort.signal});await tick();
  const rejected=assert.rejects(first,{name:'AbortError'});abort.abort();await rejected;assert.equal(oldSignal.aborted,true);
  const replacement=()=>{calls++;return new Promise(resolve=>{releaseNew=resolve;});};const next=work.get('image',replacement);await tick();releaseOld('discarded');await tick();
  const joined=work.get('image',replacement);releaseNew('new features');assert.deepEqual(await Promise.all([next,joined]),['new features','new features']);assert.equal(calls,1);
  await assert.rejects(work.get('failure',()=>{throw Error('TEST failed');}));assert.equal(await work.get('failure',()=>42),42);
});
