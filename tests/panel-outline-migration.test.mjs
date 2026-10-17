import {installEngineWorkerFixture} from './engine-worker-fixture.mjs';
installEngineWorkerFixture();
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const {document,window}=parseHTML(await readFile(new URL('../extension/panel.html',import.meta.url),'utf8'));
globalThis.document=document;globalThis.window=window;
const saved={referenceImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',referenceSpecs:{},matchingPolicy:'title-groups-v15',keywordPolicy:'best-sellers-v1',matchRevision:1,referenceContext:{collectionRevision:'declared-product-v1',title:'Captured reference'},items:[{id:'601123456789001',title:'Captured candidate',url:'https://www.temu.com/goods.html?goods_id=601123456789001',imageUrl:'https://img.kwcdn.com/migration-candidate.jpg',status:'pending',autoAttempt:1,subjectAttempt:1,outlineMatch:{revision:'stale',matched:true}}],pages:[]};
let lastSaved;const phases=[];
globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{session:{get:async()=>({'temuMatch:1':saved}),set:async value=>{lastSaved=value['temuMatch:1'];}},local:{get:async()=>({})},onChanged:{addListener:()=>{}}},tabs:{create:()=>{throw Error('No new page during review');}},runtime:{}};
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/health'))return {ok:true,json:async()=>({engine:'local',model:{state:'ready',message:'TEST',progress:100}})};
  assert.ok(url.endsWith('/compare'));const body=JSON.parse(options.body);phases.push(body.phase);
  return {ok:true,json:async()=>({ok:true,comparison:body.phase==='subject-review'?{status:'outline-match',outlineMatch:{revision:'subject-outline-v1',valid:true,matched:true,iou:.96,boundaryCoverage:.97,priorStatus:'pending'},matchStage:'subject-review'}:{status:'pending',samePhoto:false,imageSimilarity:.2}})};
};
await import('../extension/panel.js');
test('old completed attempts are cleared by the new policy so previously uncertain products receive the outline fallback',async()=>{
  for(let i=0;i<40;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(phases,['image-priority','page-match','subject-review']);assert.equal(lastSaved.matchingPolicy,'title-groups-outline-v16');assert.equal(lastSaved.items[0].status,'outline-match');assert.equal(lastSaved.items[0].outlineMatch.revision,'subject-outline-v1');
});
test.after(()=>window.dispatchEvent(new window.Event('pagehide')));
