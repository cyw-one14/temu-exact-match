import test from 'node:test';import assert from 'node:assert/strict';
import {LocalEngineClient,ENGINE_REVISION} from '../extension/local-engine-client.mjs';
test('local transport uses only paired loopback JSON endpoints and keeps out-of-order responses with their callers',async()=>{
  const rows=[];const client=new LocalEngineClient({fetchService:function(url,options){assert.equal(this,globalThis);return new Promise(resolve=>rows.push({url,options,resolve}));}});
  const a=client.request('/compare',{candidateId:'A'}),b=client.request('/compare',{candidateId:'B'});
  assert.equal(rows[0].url,'http://127.0.0.1:43187/compare');assert.equal(rows[0].options.headers['X-Temu-Client'],'exact-match');assert.equal(rows[0].options.credentials,'omit');assert.equal(rows[0].options.redirect,'error');
  rows[1].resolve({ok:true,json:async()=>({ok:true,id:'B'})});rows[0].resolve({ok:true,json:async()=>({ok:true,id:'A'})});assert.equal((await a).id,'A');assert.equal((await b).id,'B');
  await assert.rejects(client.request('https://attacker.example/',{}),/无效/);
});
test('cancellation discards late responses without stopping the resident service and a new request still works',async()=>{
  const rows=[];const client=new LocalEngineClient({fetchService:(url,options)=>new Promise(resolve=>rows.push({options,resolve}))}),abort=new AbortController();
  const a=client.request('/compare',{}, {signal:abort.signal});abort.abort();rows[0].resolve({ok:true,json:async()=>({ok:true,status:'visual-match'})});await assert.rejects(a,{name:'AbortError'});
  const b=client.request('/compare',{});client.close();assert.equal(rows[1].options.signal.aborted,true);rows[1].resolve({ok:true,json:async()=>({ok:true})});await assert.rejects(b,{name:'AbortError'});
  const next=client.request('/health');rows[2].resolve({ok:true,json:async()=>({ok:true,engineRevision:ENGINE_REVISION})});assert.equal((await next).ok,true);
});
test('wrong backend revisions, service errors and missing service stay visible failures',async()=>{
  const stale=new LocalEngineClient({fetchService:async()=>({ok:true,json:async()=>({ok:true,engineRevision:'old'})})});await assert.rejects(stale.request('/health'),/版本需要更新/);
  const missing=new LocalEngineClient({recoveryTimeoutMs:0,fetchService:async()=>{throw new TypeError('network');}});await assert.rejects(missing.request('/compare',{}),/本机识别初始化失败/);
  const failed=new LocalEngineClient({fetchService:async()=>({ok:false,json:async()=>({ok:false,error:'model failed'})})});await assert.rejects(failed.request('/compare',{}),/model failed/);
});

test('a dropped native request waits for ready then retries its original product payload once',async()=>{
  const payload={candidateId:'A',imageUrl:'https://img.kwcdn.com/captured-A.jpg'},bodies=[],states=[];let polls=0;
  const client=new LocalEngineClient({retryDelayMs:1,onConnectionState:state=>states.push(state),fetchService:async(url,options)=>{
    if(url.endsWith('/health'))return {ok:true,json:async()=>({engineRevision:ENGINE_REVISION,model:{state:++polls===1?'loading':'ready'}})};
    bodies.push(options.body);if(bodies.length===1){payload.candidateId='OTHER';throw new TypeError('connection lost');}
    return {ok:true,json:async()=>({ok:true,comparison:{status:'pending'}})};
  }});
  const result=await client.request('/compare',payload);
  assert.equal(result.comparison.status,'pending');assert.equal(polls,2);assert.deepEqual(states,['recovering','ready']);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(JSON.parse(bodies[1]).candidateId,'A');
});

test('stopping during reconnection cancels retries and a prolonged outage remains an unfinished service error',async()=>{
  const controller=new AbortController();let calls=0;
  const client=new LocalEngineClient({onConnectionState:()=>controller.abort(),fetchService:async()=>{calls++;throw new TypeError('network');}});
  await assert.rejects(client.request('/compare',{}, {signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
  const failed=new LocalEngineClient({recoveryTimeoutMs:0,fetchService:async()=>{throw new TypeError('network');}});
  await assert.rejects(failed.request('/compare',{}),error=>error.serviceUnavailable===true&&/桌面/.test(error.message));
});

test('HTTP errors and a mismatched model version are never silently retried as recovered matches',async()=>{
  let calls=0;
  const rejected=new LocalEngineClient({fetchService:async()=>{calls++;return {ok:false,json:async()=>({ok:false,error:'bad captured input'})};}});
  await assert.rejects(rejected.request('/compare',{}),/bad captured input/);assert.equal(calls,1);
  const stale=new LocalEngineClient({retryDelayMs:1,fetchService:async url=>{if(!url.endsWith('/health'))throw new TypeError('offline');return {ok:true,json:async()=>({engineRevision:'old',model:{state:'ready'}})};}});
  await assert.rejects(stale.request('/compare',{}),/版本需要更新/);
});

test('a declared native worker failure stays an unfinished service error without retrying HTTP failures',async()=>{
  let calls=0;const client=new LocalEngineClient({fetchService:async()=>{calls++;return {ok:false,json:async()=>({ok:false,serviceUnavailable:true,error:'TEST model worker stopped'})};}});
  await assert.rejects(client.request('/compare',{}),error=>error.serviceUnavailable===true&&/worker stopped/.test(error.message));assert.equal(calls,1);
});
