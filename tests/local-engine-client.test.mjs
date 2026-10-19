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
  const missing=new LocalEngineClient({fetchService:async()=>{throw new TypeError('network');}});await assert.rejects(missing.request('/compare',{}),/本机识别初始化失败/);
  const failed=new LocalEngineClient({fetchService:async()=>({ok:false,json:async()=>({ok:false,error:'model failed'})})});await assert.rejects(failed.request('/compare',{}),/model failed/);
});
