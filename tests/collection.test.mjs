import test from 'node:test';
import assert from 'node:assert/strict';
import {limitedCandidates,createCollection,collectionDecision,pauseCollection,resumeCollection,recordCollectionAdvance,collectionText} from '../shared/collection.mjs';
const page=(options={})=>({state:'results',products:[{id:'1',imageUrl:'https://img.kwcdn.com/a.jpg',title:'Captured title'}],navigation:{supported:true,queryKey:'search-a',pageKey:'page-1',position:0,height:800,atBottom:true,loading:false,nextKind:'next',nextKey:'next:page-2',endEvidence:'',...options}});
test('collection below 100 can continue beyond two minutes while new results arrive',()=>{
  const job=createCollection({source:'provider',tabId:1,now:0});
  for(let i=0;i<20;i++)assert.equal(collectionDecision(job,page({pageKey:'page-'+i}),{total:(i+1)*4,now:i*20000}),'advance');
  assert.equal(job.total,80);assert.equal(job.status,'running');assert.equal(job.pageKeys.length,20);assert.match(collectionText(job),/全站覆盖未核实/);
});

test('a 175-row page retains only its first 100 distinct candidates; existing prices can still update at the cap',()=>{
  const rows=Array.from({length:175},(_,i)=>({id:String(i),title:'Captured '+i}));const retained=limitedCandidates(rows,[]);assert.equal(retained.length,100);assert.equal(retained.at(-1).id,'99');
  const updates=limitedCandidates([{id:'174'},{id:'0',priceText:'$4.12'},{id:'99',priceText:'$5.00'}],retained);assert.deepEqual(updates.map(item=>item.id),['0','99']);assert.equal(updates[0].priceText,'$4.12');
  const job=createCollection({now:0});assert.equal(collectionDecision(job,page(),{total:100,now:0}),'paused');assert.equal(job.reason,'limit-reached');resumeCollection(job);assert.equal(job.status,'paused');assert.match(collectionText(job),/100条上限/);
});
test('different sources and retrieval queries share the same 100-record analysis budget',()=>{
  const existing=Array.from({length:95},(_,i)=>({id:String(i),salesSource:i<90?'provider-visible':'temu-visible'}));
  const incoming=Array.from({length:20},(_,i)=>({id:String(i+100)}));assert.equal(limitedCandidates(incoming,existing,'provider-visible').length,5);
  const job=createCollection({source:'temu',now:0});assert.equal(collectionDecision(job,page(),{total:5,analysisTotal:100,now:0}),'paused');assert.equal(job.reason,'limit-reached');assert.equal(job.total,5);assert.equal(job.analysisTotal,100);
});
test('a clicked next page waits for rendering and does not click repeatedly; new pages release it',()=>{
  const job=createCollection({source:'provider',now:0});collectionDecision(job,page(),{total:40,now:0});recordCollectionAdvance(job,{action:'next'});
  assert.equal(collectionDecision(job,page(),{total:40,now:2000}),'wait');
  assert.equal(collectionDecision(job,page({pageKey:'page-2'}),{total:60,now:4000}),'advance');
  recordCollectionAdvance(job,{action:'next'});assert.equal(collectionDecision(job,page({pageKey:'page-2'}),{total:60,now:20000}),'paused');assert.equal(job.reason,'stalled');
});
test('explicit end and stalled bottom retain different reasons, neither declares the whole site complete',()=>{
  for(const [endEvidence,reason,timeout]of [['没有更多商品了','result-end',4000],['','stalled',15000]]){
    const job=createCollection({source:'temu',now:0}),data=page({nextKind:'',nextKey:'',endEvidence});
    assert.equal(collectionDecision(job,data,{total:70,now:0}),'wait');assert.equal(collectionDecision(job,data,{total:70,now:timeout}),'paused');assert.equal(job.reason,reason);assert.doesNotMatch(collectionText(job),/全站.*(?:完毕|完成)/);
  }
});
test('changed query, login, verification and unavailable navigation stop collection and allow an explicit resume',()=>{
  for(const [data,reason]of [[page({queryKey:'other'}),'query-changed'],[{state:'login'},'login'],[{challenge:true},'challenge'],[{state:'unsupported'},'unsupported'],[{products:[]},'navigation-unavailable']]){
    const job=createCollection({queryKey:'search-a'});assert.equal(collectionDecision(job,data),'paused');assert.equal(job.reason,reason);resumeCollection(job);assert.equal(job.status,'running');assert.equal(job.queryKey,'search-a');
  }
  const job=createCollection();pauseCollection(job,'manual');assert.equal(collectionDecision(job,page()),'paused');
});
test('loading does not falsely finish or advance; persistent loading and empty results pause without fake products',()=>{
  const job=createCollection({now:0}),data=page({loading:true,nextKind:'',endEvidence:'没有更多商品了'});
  assert.equal(collectionDecision(job,data,{total:60,now:0}),'wait');assert.equal(collectionDecision(job,data,{total:60,now:60000}),'paused');assert.equal(job.reason,'loading-timeout');
  const empty=createCollection({now:0}),waiting={...page({nextKind:''}),state:'waiting',products:[]};assert.equal(collectionDecision(empty,waiting,{now:0}),'wait');assert.equal(collectionDecision(empty,waiting,{now:15000}),'paused');assert.equal(empty.total,0);assert.equal(empty.reason,'no-results');
});
test('pagination that cycles back without new products pauses instead of looping forever',()=>{
  const job=createCollection({now:0});collectionDecision(job,page(),{total:40,now:0});recordCollectionAdvance(job,{action:'next'});
  collectionDecision(job,page({pageKey:'page-2'}),{total:50,now:2000});recordCollectionAdvance(job,{action:'next'});
  assert.equal(collectionDecision(job,page(),{total:50,now:4000}),'paused');assert.equal(job.reason,'navigation-cycle');
});
