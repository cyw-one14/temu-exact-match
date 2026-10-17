import test from 'node:test';
import assert from 'node:assert/strict';
import {ManualMemoryStore,referenceMemoryKey,candidateMemoryKey,memoryStorageKey,memoryRecord} from '../extension/manual-memory.mjs';
const referenceKey='goods:601123456789900',candidateKey='provider-visible:601123456789001';
function disk(){const data={};return {data,get:async key=>structuredClone({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))};}

test('reference IDs survive gallery/tracking/title changes; missing IDs use exact URL or uploaded-byte hashes',async()=>{
  assert.equal(await referenceMemoryKey({selection:{productId:'601123456789900',imageUrl:'https://img.kwcdn.com/old.jpg'}}),referenceKey);
  assert.equal(await referenceMemoryKey({selection:{productId:'601123456789900',imageUrl:'https://img.kwcdn.com/new.jpg',title:'Changed'}}),referenceKey);
  const first=await referenceMemoryKey({referenceImage:'data:image/png;base64,AQID'}),mimeChanged=await referenceMemoryKey({referenceImage:'data:image/jpeg;base64,AQID'});
  assert.equal(first,mimeChanged);assert.notEqual(first,await referenceMemoryKey({referenceImage:'data:image/png;base64,AQIE'}));
  assert.equal(await referenceMemoryKey({referenceImage:'data:image/png;base64,AQIE',manualReferenceKey:first}),first,'remember the original file identity before a later PNG conversion');
  const url=await referenceMemoryKey({referenceImage:'https://img.kwcdn.com/reference.jpg'});assert.match(url,/^image-url:[a-f0-9]{64}$/);
  assert.equal(await referenceMemoryKey({referenceImage:'https://evil.example/reference.jpg'}),'');assert.equal(await referenceMemoryKey({referenceImage:''}),'');
  assert.equal(candidateMemoryKey({id:'601123456789001',salesSource:'provider-visible'}),candidateKey);assert.equal(candidateMemoryKey({id:'not-a-product'}),'');
});

test('serialized writes from different windows do not lose other corrections and a new worker reads durable records',async()=>{
  const storage=disk(),worker=new ManualMemoryStore(storage);
  await Promise.all([worker.update({referenceKey,entries:[{candidateKey,decision:'same'}]}),worker.update({referenceKey,entries:[{candidateKey:'temu-visible:601123456789002',decision:'different'}]})]);
  const key=memoryStorageKey(referenceKey);assert.equal(storage.data[key].revision,2);assert.equal(Object.keys(storage.data[key].entries).length,2);
  const restarted=new ManualMemoryStore(storage),record=await restarted.update({referenceKey,entries:[{candidateKey,decision:'different'}]});
  assert.equal(record.entries[candidateKey].decision,'different');assert.equal(record.entries['temu-visible:601123456789002'].decision,'different');assert.equal(record.revision,3);
  assert.ok(Object.values(record.entries).every(entry=>entry.source==='user'&&Number.isFinite(Date.parse(entry.updatedAt))));
  assert.doesNotMatch(JSON.stringify(storage.data),/price|title|imageUrl|data:image/);
});

test('restoring automatic judgment survives legacy import, and migration never overwrites a remembered user decision',async()=>{
  const storage=disk(),worker=new ManualMemoryStore(storage),entries=[{candidateKey,decision:'same',updatedAt:'2026-10-16T01:00:00Z'}];
  let record=await worker.update({referenceKey,entries,onlyMissing:true});assert.equal(record.entries[candidateKey].updatedAt,'2026-10-16T01:00:00.000Z');
  await worker.update({referenceKey,entries:[{candidateKey,decision:'automatic'}]});
  record=await worker.update({referenceKey,entries,onlyMissing:true});assert.equal(record.entries[candidateKey].decision,'automatic');assert.equal(record.revision,2);
  record=await worker.update({referenceKey,entries:[{candidateKey,decision:'different'}],onlyMissing:false});assert.equal(record.entries[candidateKey].decision,'different');
  assert.equal(memoryRecord(record,'goods:601123456789901').entries[candidateKey],undefined);
});

test('a quota failure cannot erase saved corrections or poison subsequent writes; malformed records never classify',async()=>{
  const storage=disk(),worker=new ManualMemoryStore(storage);await worker.update({referenceKey,entries:[{candidateKey,decision:'same'}]});
  const original=storage.set;storage.set=async()=>{throw Error('TEST quota');};
  await assert.rejects(worker.update({referenceKey,entries:[{candidateKey,decision:'different'}]}),/quota/);
  assert.equal(storage.data[memoryStorageKey(referenceKey)].entries[candidateKey].decision,'same');
  storage.set=original;assert.equal((await worker.update({referenceKey,entries:[{candidateKey,decision:'automatic'}]})).revision,2);
  await assert.rejects(worker.update({referenceKey:'title:same words',entries:[{candidateKey,decision:'same'}]}),/标识/);
  await assert.rejects(worker.update({referenceKey,entries:[{candidateKey:'other:123456',decision:'same'}]}),/标识/);
  assert.deepEqual(memoryRecord({schema:1,referenceKey,revision:1,entries:{[candidateKey]:{source:'model',decision:'same',updatedAt:new Date().toISOString()}}},referenceKey).entries,{});
});
