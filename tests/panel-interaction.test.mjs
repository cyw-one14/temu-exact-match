import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {parseSales} from '../shared/core.mjs';

// Isolated, explicitly synthetic UI data; never enters a production query.
const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const makeItem=(id,status='visual-match',source='provider-visible')=>({id,title:'TEST original listing '+id,url:'https://www.temu.com/goods.html?goods_id='+id,imageUrl:'https://img.kwcdn.com/test-'+id+'.jpg',salesSource:source,status,autoAttempt:1,subjectAttempt:1,priceText:'$5.99',sales:parseSales('100 sold'),market:'us',capturedAt:'2026-10-16T00:00:00Z',evidence:['TEST retained automatic evidence']});
const savedState=items=>({referenceImage:image,referenceSpecs:{},profile:{name:'TEST reference'},referenceContext:{collectionRevision:'declared-product-v1',title:'TEST reference'},matchingPolicy:'title-groups-outline-v16',keywordPolicy:'best-sellers-v1',matchRevision:1,items,pages:[],keywords:[],selectedQueries:[],collectionHistory:[]});
const delay=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let i=0;i<400;i++){if(check())return;await delay();}assert.fail('UI did not reach expected state');}
let mountCount=0;
async function mount(saved,{compare,selection=null,provider=null,storageFails=false}={}){
  const {document,window}=parseHTML(html);globalThis.document=document;globalThis.window=window;
  let lastSaved=null;const requests=[],messages=[];
  globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{session:{get:async()=>({'temuMatch:1':structuredClone(saved),'temuSelection:1':selection}),set:async data=>{if(storageFails)throw Error('TEST quota');lastSaved=structuredClone(data['temuMatch:1']);}},local:{get:async()=>({preferences:{onImageClick:'local'}})},onChanged:{addListener:()=>{}}},tabs:{create:()=>{throw Error('No navigation during UI adjustments');}},runtime:{sendMessage:async message=>{messages.push(message);return {ok:true,data:provider};}}};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return {ok:true,json:async()=>({engine:'local',model:{state:'ready',progress:100,message:'TEST ready'}})};
    const body=JSON.parse(options.body);requests.push(body);
    const comparison=await compare?.(body,options.signal);
    return {ok:true,json:async()=>({ok:true,comparison:comparison||{status:'pending'}})};
  };
  await import('../extension/panel.js?interaction='+(++mountCount));
  return {document,window,requests,messages,get saved(){return lastSaved;},get:(id)=>document.getElementById(id),close(){window.dispatchEvent(new window.Event('pagehide'));}};
}
const action=(ui,section,id,decision,source='provider-visible')=>ui.get(section).querySelector(`[data-product-id="${id}"][data-source="${source}"] [data-action="${decision}"]`);
async function exportData(ui){let blob;const original=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:test';};try{ui.get('export').click();return JSON.parse(await blob.text());}finally{URL.createObjectURL=original;}}

test('manual moves update only the selected source, rankings and export, survive reopening and can restore automation',async()=>{
  let ui=await mount(savedState([makeItem('601123456789001'),makeItem('601123456789002','different'),makeItem('601123456789001','visual-match','temu-visible')]));
  const originalTitle=ui.get('exact-results').querySelector('.product-name').textContent;
  action(ui,'exact-results','601123456789001','different').click();
  await until(()=>ui.saved?.items[0].manualClassification);
  assert.equal(ui.get('exact-results').children.length,1);assert.equal(ui.get('excluded-results').children.length,2);
  assert.equal(ui.saved.items[0].status,'visual-match');assert.equal(ui.saved.items[2].manualClassification,undefined);
  assert.equal(ui.get('keywords').querySelectorAll('.seller-entry').length,1);
  action(ui,'excluded-results','601123456789002','same').click();await until(()=>ui.saved?.items[1].manualClassification);
  assert.equal(ui.get('exact-results').children.length,2);assert.match(ui.get('exact-results').textContent,/人工归为同款/);
  assert.match(ui.get('keywords').textContent,/人工归为同款/);assert.match(ui.get('count').textContent,/1 个人工归类/);
  let data=await exportData(ui);
  assert.equal(data.products[0].effectiveStatus,'manual-different');assert.equal(data.products[0].status,'visual-match');assert.equal(data.products[0].keywordEvidence.length,0);
  assert.equal(data.products[1].effectiveStatus,'manual-match');assert.equal(data.products[1].status,'different');assert.equal(data.products[1].keywordEvidence[0].matchStatus,'manual-match');
  assert.deepEqual(data.products[0].evidence,['TEST retained automatic evidence']);assert.equal(data.products[0].title,originalTitle);assert.equal(data.products[0].priceText,'$5.99');
  const restored=ui.saved;ui.close();
  ui=await mount(restored);
  assert.equal(ui.get('exact-results').children.length,2);assert.equal(ui.requests.length,0);
  action(ui,'excluded-results','601123456789001','restore').click();await until(()=>ui.saved&&!ui.saved.items[0].manualClassification);
  assert.equal(ui.get('exact-results').children.length,3);assert.equal(ui.saved.items[0].status,'visual-match');
  ui.get('compare-collected').click();await until(()=>ui.get('cancel').hidden);
  assert.equal(ui.saved.items[1].manualClassification.decision,'same');assert.equal(ui.requests.length,0);
  const selected={id:'TEST new reference',windowId:1,imageUrl:'https://img.kwcdn.com/test-new-reference.jpg'};
  const previous=ui.saved;ui.close();ui=await mount(previous,{selection:selected});
  assert.equal(ui.get('exact-results').children.length,0);assert.equal(ui.get('excluded-results').children.length,0);ui.close();
});

test('uncertain hidden candidates can be classified and restored, and storage failures remain visible',async()=>{
  const ui=await mount(savedState([makeItem('601123456789003','pending')]),{storageFails:true});
  ui.get('pending-toggle').click();
  action(ui,'pending-results','601123456789003','same').click();
  await until(()=>ui.get('status').textContent.includes('存储空间不足'));
  assert.equal(ui.get('exact-results').children.length,1);assert.match(ui.get('status').textContent,/存储空间不足/);
  assert.doesNotMatch(ui.get('status').textContent,/已保存到本次分析/);
  action(ui,'exact-results','601123456789003','restore').click();
  assert.equal(ui.get('exact-results').children.length,0);assert.match(ui.get('pending-count').textContent,/共 1/);ui.close();
});

test('provider updates preserve a manual correction while refreshing original fields and prices',async()=>{
  const item={...makeItem('601123456789004','different'),manualClassification:{source:'user',decision:'same',updatedAt:'2026-10-16T01:00:00Z'}};
  const saved={...savedState([item]),providerJob:{tabId:7,expectedImageUrl:'https://img.kwcdn.com/test-reference.jpg',manualUpload:true},collection:{source:'provider',tabId:7,status:'paused',reason:'manual',productIds:[item.id],total:1,pageKeys:[]}};
  const provider={state:'results',queryImageUrl:saved.providerJob.expectedImageUrl,pageUrl:'https://www.temaishuju.com/plugin/search-image?TEST',capturedAt:'2026-10-16T02:00:00Z',products:[{id:item.id,url:item.url,imageUrl:item.imageUrl,title:'TEST changed original listing',priceText:'$4.12',salesFields:[{label:'已售出',value:'200'}]}],keywords:[]};
  const ui=await mount(saved,{provider});ui.get('read-provider').click();
  await until(()=>ui.saved?.items[0].priceText==='$4.12');
  assert.equal(ui.saved.items[0].manualClassification.decision,'same');assert.equal(ui.requests.length,0);assert.match(ui.get('exact-results').textContent,/TEST changed original listing/);assert.match(ui.get('exact-results').textContent,/人工归为同款/);
  ui.get('resume-collection').click();
  assert.equal(ui.get('progress-title').textContent,'正在收集商品');assert.match(ui.get('progress-count').textContent,/已收集 1 \/ 最多 100/);assert.equal(ui.get('progress-percent').textContent,'1%');
  ui.get('stop-collection').click();assert.equal(ui.get('progress-percent').textContent,'100%');assert.match(ui.get('progress-count').textContent,/已完成核对 1 \/ 1/);ui.close();
});

test('subject progress counts completed responses, keeps in-flight user corrections, and pauses below 100%',async()=>{
  const pending=[makeItem('601123456789005','pending'),makeItem('601123456789006','pending')];pending.forEach(item=>delete item.subjectAttempt);
  const deferred=[];
  const ui=await mount(savedState(pending),{compare:(body,signal)=>new Promise((resolve,reject)=>{
    if(body.phase!=='subject-review'){resolve({status:'pending',samePhoto:false,imageSimilarity:.2});return;}
    deferred.push({body,resolve});signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
  })});
  await until(()=>deferred.length===1);
  assert.equal(ui.get('progress-title').textContent,'正在核对商品主体');assert.equal(ui.get('progress-bar').getAttribute('aria-valuenow'),'0');assert.match(ui.get('progress-count').textContent,/0 \/ 2/);
  ui.get('pending-toggle').click();action(ui,'pending-results',pending[0].id,'same').click();
  assert.equal(ui.get('progress-percent').textContent,'50%');
  deferred[0].resolve({status:'different',evidence:['TEST automatic difference']});await until(()=>deferred.length===2);
  assert.equal(ui.saved.items[0].status,'different');assert.equal(ui.saved.items[0].manualClassification.decision,'same');assert.equal(ui.get('exact-results').children.length,1);
  ui.get('cancel').click();await until(()=>ui.get('cancel').hidden);
  assert.equal(ui.get('progress-title').textContent,'核对已暂停');assert.equal(ui.get('progress-percent').textContent,'50%');assert.equal(ui.saved.items[1].subjectAttempt,undefined);
  ui.get('compare-collected').click();await until(()=>deferred.length===3);
  assert.equal(deferred[2].body.candidateId,pending[1].id);
  deferred[2].resolve({status:'pending',evidence:['TEST inconclusive']});await until(()=>ui.get('cancel').hidden);
  assert.equal(ui.get('progress-title').textContent,'核对完成');assert.equal(ui.get('progress-percent').textContent,'100%');assert.match(ui.get('progress-totals').textContent,/无法确认 1/);assert.equal(ui.saved.items[0].manualClassification.decision,'same');ui.close();
});

test('a failed connection has a visible progress error and preserves the unconfirmed result',async()=>{
  const item=makeItem('601123456789007','pending');delete item.subjectAttempt;
  const ui=await mount(savedState([item]),{compare:()=>{throw new TypeError('TEST connection failure');}});
  await until(()=>ui.get('progress-title').textContent==='处理遇到问题');
  assert.match(ui.get('progress-detail').textContent,/无法连接本机识别服务/);
  assert.equal(ui.get('analysis-progress').dataset.phase,'error');assert.equal(ui.get('exact-results').children.length,0);assert.equal(ui.saved.items[0].status,'pending');ui.close();
});
