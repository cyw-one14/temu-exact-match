import {installEngineWorkerFixture} from './engine-worker-fixture.mjs';
installEngineWorkerFixture();
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const {document,window}=parseHTML(await readFile(new URL('../extension/panel.html',import.meta.url),'utf8'));
globalThis.document=document;globalThis.window=window;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const saved={matchingPolicy:'title-groups-outline-v16',keywordPolicy:'best-sellers-v1',matchRevision:1,referenceImage:image,referenceSpecs:{},referenceContext:{collectionRevision:'declared-product-v1',title:'Captured gloves'},keywords:[],selectedQueries:[],items:[1,2].map(i=>({id:'60112345678900'+i,title:'Captured glove '+i,url:'https://www.temu.com/goods.html?goods_id=60112345678900'+i,imageUrl:'https://img.kwcdn.com/'+i+'.jpg',rawText:'Captured glove',status:'pending',autoAttempt:1,matchSource:'automated',capturedAt:'2026-10-10T00:00:00Z'})),pages:[],collection:{source:'provider',status:'paused',reason:'manual',total:2,pageKeys:['page-1']},collectionHistory:[]};
const requests=[];let lastSaved,tabsOpened=0;
globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{session:{get:async()=>({'temuMatch:1':saved}),set:async value=>{lastSaved=value['temuMatch:1'];}},local:{get:async()=>({})},onChanged:{addListener:()=>{}}},runtime:{openOptionsPage:async()=>{}},tabs:{create:async()=>{tabsOpened++;}}};
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/health'))return {ok:true,json:async()=>({engine:'local',model:{state:'ready',message:'TEST',progress:100}})};
  assert.ok(url.endsWith('/compare'));const body=JSON.parse(options.body);requests.push(body);
  return {ok:true,json:async()=>({ok:true,comparison:{status:'visual-match',evidence:['TEST subject match'],missing:[],matchStage:'subject-review'}})};
};
await import('../extension/panel.js');
test('unfinished subject review resumes without new candidates or repeating completed page-image work',async()=>{
  for(let i=0;i<30;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(requests.length,2);assert.ok(requests.every(request=>request.phase==='subject-review'));assert.ok(lastSaved.items.every(item=>item.status==='visual-match'&&item.subjectAttempt===1));assert.equal(tabsOpened,0);assert.equal(document.querySelectorAll('#exact-results .product').length,2);
});
test.after(()=>window.dispatchEvent(new window.Event('pagehide')));
