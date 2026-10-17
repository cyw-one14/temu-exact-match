import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserEngineClient} from '../extension/engine-client.mjs';
const worker=()=>({sent:[],postMessage(message){this.sent.push(message);},terminate(){this.closed=true;},send(data){this.onmessage({data});}});
test('browser requests use one worker, report live state during inference, and keep responses bound to request IDs',async()=>{
  const w=worker(),client=new BrowserEngineClient({createWorker:()=>w});
  const first=client.request('/compare',{candidateId:'A'}),second=client.request('/compare',{candidateId:'B'});
  w.send({type:'state',health:{engine:'browser',model:{state:'ready'}}});assert.equal((await client.request('/health')).model.state,'ready');
  w.send({id:w.sent[2].id,result:{status:'pending'}});w.send({id:w.sent[1].id,result:{status:'visual-match'}});
  assert.equal((await first).status,'visual-match');assert.equal((await second).status,'pending');assert.equal(w.sent.length,3);client.reset();
});
test('cancelling stops worker computation and ignores late responses; reopening creates a fresh worker',async()=>{
  const workers=[],client=new BrowserEngineClient({createWorker:()=>{const w=worker();workers.push(w);return w;}}),abort=new AbortController();
  const job=client.request('/compare',{}, {signal:abort.signal});abort.abort();await assert.rejects(job,{name:'AbortError'});assert.equal(workers[0].closed,true);
  workers[0].send({id:1,result:{status:'visual-match'}});
  const next=client.request('/prepare',{});workers[1].send({id:2,result:{ok:true}});assert.equal((await next).ok,true);client.reset();
});
test('worker startup and operation failures stay errors and never become a product verdict',async()=>{
  const w=worker(),client=new BrowserEngineClient({createWorker:()=>w});const job=client.request('/compare',{});w.send({id:1,error:'image decode failed'});await assert.rejects(job,/image decode failed/);
  const other=client.request('/prepare',{});w.onerror({message:'out of memory'});await assert.rejects(other,/初始化失败/);assert.equal(client.state.model.state,'error');assert.equal(client.pending.size,0);
});
