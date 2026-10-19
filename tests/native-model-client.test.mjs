import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {Worker} from 'node:worker_threads';import http from 'node:http';
import {NativeModelRuntime,NativeModelPool,createNativeProcess} from '../server/native-model-client.mjs';
import {serializeTensors,deserializeTensors} from '../server/native-tensors.mjs';
class FakeWorker extends EventEmitter{messages=[];ref(){}unref(){}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;return Promise.resolve();}}
test('tensor serialization retains image-processor size metadata and optional outputs',()=>{
  const values={pixel_values:{type:'float32',data:new Float32Array([1]),dims:[1,1]},original_sizes:[[800,800]],reshaped_input_sizes:[[224,224]],optional:undefined};
  const restored=deserializeTensors(structuredClone(serializeTensors(values)),class{constructor(type,data,dims){Object.assign(this,{type,data,dims});}});
  assert.deepEqual(restored.original_sizes,values.original_sizes);assert.deepEqual(restored.reshaped_input_sizes,values.reshaped_input_sizes);assert.equal(restored.optional,undefined);
  for(const key of ['type','dims','data'])assert.deepEqual(restored.pixel_values[key],values.pixel_values[key]);
});
test('native model responses stay with their callers and typed tensor inputs remain intact',async()=>{
  const worker=new FakeWorker(),runtime=new NativeModelRuntime({createWorker:()=>worker});
  try{
    const a=runtime.request('run','segment',{a:{data:new Float32Array([1,2])}}),b=runtime.request('run','features',{});
    worker.emit('message',{id:2,ok:true,value:'B'});worker.emit('message',{id:1,ok:true,value:'A'});assert.equal(await a,'A');assert.equal(await b,'B');
    assert.deepEqual([...worker.messages[0].inputs.a.data],[1,2]);
    const load=runtime.model('features',class{constructor(type,data,dims){Object.assign(this,{type,data,dims});}});
    worker.emit('message',{id:3,ok:true,value:null});const model=await load;
    const input={input_ids:{type:'int64',data:new BigInt64Array([2n,5n]),dims:[1,2]}};const output=model(input);
    assert.deepEqual([...worker.messages.at(-1).inputs.input_ids.data],[2n,5n]);
    worker.emit('message',{id:4,ok:true,value:{last_hidden_state:{type:'float32',data:new Float32Array([.25]),dims:[1,1]}}});
    assert.equal((await output).last_hidden_state.data[0],.25);assert.deepEqual([...input.input_ids.data],[2n,5n]);
  }finally{await runtime.close();}
});
test('fatal worker failures and stalls reject work, expose an error for recovery and never return a verdict',async()=>{
  for(const stall of [false,true]){
    const worker=new FakeWorker(),runtime=new NativeModelRuntime({createWorker:()=>worker,timeoutMs:15});
    try{const task=runtime.request('run','segment',{});if(!stall)worker.emit('error',Error('TEST worker failure'));await assert.rejects(task);assert.equal(runtime.state.state,'error');assert.equal(runtime.jobs.size,0);await assert.rejects(runtime.request('run','features',{}));if(stall)assert.equal(worker.terminated,true);}finally{await runtime.close();}
  }
});
test('a synchronous busy model thread leaves the main HTTP event loop responsive',async()=>{
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');parentPort.on('message',m=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200);parentPort.postMessage({id:m.id,ok:true,value:null});});`,{eval:true});
  const runtime=new NativeModelRuntime({createWorker:()=>worker});const server=http.createServer((req,res)=>res.end('ready'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let completed=false;
  try{
    const task=runtime.request('run','segment',{}).then(()=>{completed=true;});
    for(let i=0;i<3;i++){const response=await fetch('http://127.0.0.1:'+server.address().port,{signal:AbortSignal.timeout(600)});assert.equal(await response.text(),'ready');}
    assert.equal(completed,false);await task;
  }finally{await runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('production advanced IPC runs three isolated native lanes simultaneously and preserves metadata/tensors',async()=>{
  const children=[],pool=new NativeModelPool({size:3,createRuntime:()=>new NativeModelRuntime({createWorker:()=>{const child=createNativeProcess(new URL('./fixtures/native-ipc.mjs',import.meta.url));children.push(child);return child;}})});
  const Tensor=class{constructor(type,data,dims){Object.assign(this,{type,data,dims});}};
  try{
    const model=await pool.model('segment',Tensor),features=await pool.model('features',Tensor),attention=await pool.model('attention',Tensor);
    const results=await Promise.all([model,features,attention].map((run,i)=>run({value:new Tensor('int64',new BigInt64Array([BigInt(i)]),[1]),sizes:[[224+i,224]],optional:undefined})));
    assert.equal(new Set(results.map(row=>row.pid)).size,3);assert.ok(Math.max(...results.map(row=>row.started))<Math.min(...results.map(row=>row.finished)),'three synchronous operations actually overlap');
    results.forEach((row,i)=>{assert.equal(row.value.data[0],BigInt(i));assert.deepEqual(row.sizes,[[224+i,224]]);assert.equal(row.optional,undefined);});
    assert.equal((await features({})).pid,results[1].pid,'each model reuses its own stage process');
  }finally{await pool.close();assert.ok(children.every(child=>child.exitCode!==null||child.signalCode!==null),'all child processes exit on close');}
});

test('a fatal native lane rejects queued work and exposes pool failure for the watchdog',async()=>{
  const workers=[],pool=new NativeModelPool({size:3,createRuntime:()=>new NativeModelRuntime({createWorker:()=>{const worker=new FakeWorker();workers.push(worker);return worker;}})});
  try{
    const tasks=['segment','features','attention','segment'].map((model,i)=>pool.run(model,{i}));const settled=Promise.allSettled(tasks);
    workers[0].emit('error',Error('TEST failed native lane'));
    workers[1].emit('message',{id:1,ok:true,value:'other'});workers[2].emit('message',{id:1,ok:true,value:'other'});
    const rows=await settled;assert.equal(rows.filter(row=>row.status==='rejected').length,2);assert.equal(pool.state.state,'error');await assert.rejects(pool.run('features',{}));
  }finally{await pool.close();}
});

test('cancelled native jobs leave the stage queue without entering a graph, while an entered graph may finish',async()=>{
  const worker=new FakeWorker(),pool=new NativeModelPool({size:1,createRuntime:()=>new NativeModelRuntime({createWorker:()=>worker})});
  const active=new AbortController(),queued=new AbortController();
  try{
    const first=pool.run('segment',{image:'first'},{signal:active.signal}),second=pool.run('segment',{image:'cancelled'},{signal:queued.signal});
    const secondRejected=assert.rejects(second,{name:'AbortError'});queued.abort();await secondRejected;assert.equal(worker.messages.length,1);
    const firstRejected=assert.rejects(first,{name:'AbortError'});active.abort();assert.equal(worker.terminated,undefined);
    worker.emit('message',{id:1,ok:true,value:'finished entered graph'});await firstRejected;assert.equal(worker.messages.length,1);assert.notEqual(pool.state.state,'error');
    const next=pool.run('segment',{image:'new query'});worker.emit('message',{id:2,ok:true,value:'new result'});assert.equal(await next,'new result');
  }finally{await pool.close();}
});
