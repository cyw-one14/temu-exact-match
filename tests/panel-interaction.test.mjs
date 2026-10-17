import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {parseSales} from '../shared/core.mjs';
import {ManualMemoryStore,memoryStorageKey,referenceMemoryKey,candidateMemoryKey} from '../extension/manual-memory.mjs';

// Isolated, explicitly synthetic UI data; never enters a production query.
const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const makeItem=(id,status='visual-match',source='provider-visible')=>({id,title:'TEST original listing '+id,url:'https://www.temu.com/goods.html?goods_id='+id,imageUrl:'https://img.kwcdn.com/test-'+id+'.jpg',salesSource:source,status,autoAttempt:1,subjectAttempt:1,priceText:'$5.99',sales:parseSales('100 sold'),market:'us',capturedAt:'2026-10-16T00:00:00Z',evidence:['TEST retained automatic evidence']});
const savedState=items=>({referenceImage:image,referenceSpecs:{},profile:{name:'TEST reference'},referenceContext:{collectionRevision:'declared-product-v1',title:'TEST reference'},matchingPolicy:'title-groups-outline-v16',keywordPolicy:'best-sellers-v1',matchRevision:1,items,pages:[],keywords:[],selectedQueries:[],collectionHistory:[]});
const delay=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let i=0;i<400;i++){if(check())return;await delay();}assert.fail('UI did not reach expected state');}
let mountCount=0;
async function mount(saved,{compare,selection=null,provider=null,storageFails=false,localData={},memoryFails=false}={}){
  const {document,window}=parseHTML(html);globalThis.document=document;globalThis.window=window;
  let lastSaved=null;const requests=[],messages=[];
  const changeListeners=[];
  const local={get:async key=>({[key]:structuredClone(localData[key]),preferences:{onImageClick:'local'}}),set:async data=>{if(memoryFails)throw Error('TEST local quota');Object.assign(localData,structuredClone(data));for(const listener of changeListeners)listener(Object.fromEntries(Object.entries(data).map(([key,newValue])=>[key,{newValue:structuredClone(newValue)}])),'local');}};
  const memory=new ManualMemoryStore(local);
  globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{session:{get:async()=>({'temuMatch:1':structuredClone(saved),'temuSelection:1':selection}),set:async data=>{if(storageFails)throw Error('TEST quota');lastSaved=structuredClone(data['temuMatch:1']);}},local,onChanged:{addListener:fn=>changeListeners.push(fn)}},tabs:{create:()=>{throw Error('No navigation during UI adjustments');}},runtime:{sendMessage:async message=>{messages.push(message);if(message.type==='manual-memory-update'){try{return {ok:true,record:await memory.update(message)};}catch(error){return {ok:false,error:error.message};}}return {ok:true,data:provider};}}};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return {ok:true,json:async()=>({engine:'local',model:{state:'ready',progress:100,message:'TEST ready'}})};
    const body=JSON.parse(options.body);requests.push(body);
    const comparison=await compare?.(body,options.signal);
    return {ok:true,json:async()=>({ok:true,comparison:comparison||{status:'pending'}})};
  };
  await import('../extension/panel.js?interaction='+(++mountCount));
  return {document,window,requests,messages,localData,changeListeners,get saved(){return lastSaved;},get:(id)=>document.getElementById(id),close(){window.dispatchEvent(new window.Event('pagehide'));}};
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
  const restored=ui.saved,localData=ui.localData;ui.close();
  ui=await mount(restored,{localData});
  assert.equal(ui.get('exact-results').children.length,2);assert.equal(ui.requests.length,0);
  action(ui,'excluded-results','601123456789001','restore').click();await until(()=>ui.saved&&!ui.saved.items[0].manualClassification);
  assert.equal(ui.get('exact-results').children.length,3);assert.equal(ui.saved.items[0].status,'visual-match');
  ui.get('compare-collected').click();await until(()=>ui.get('cancel').hidden);
  assert.equal(ui.saved.items[1].manualClassification.decision,'same');assert.equal(ui.requests.length,0);
  const selected={id:'TEST new reference',windowId:1,imageUrl:'https://img.kwcdn.com/test-new-reference.jpg'};
  const previous=ui.saved;ui.close();ui=await mount(previous,{selection:selected,localData});
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
  await until(()=>ui.get('exact-results').children.length===0);assert.match(ui.get('pending-count').textContent,/共 1/);ui.close();
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
  assert.equal(ui.get('resume-analysis').hidden,false);assert.equal(ui.get('more-tools').hasAttribute('open'),false);
  ui.get('resume-analysis').click();await until(()=>deferred.length===3);
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

test('a new analysis remembers both decisions across gallery/title changes but keeps other reference products and sources separate',async()=>{
  const selection={id:'TEST first query',productId:'601123456789900',imageUrl:'https://img.kwcdn.com/first-gallery.jpg'};
  const items=[makeItem('601123456789011'),makeItem('601123456789012','different')];
  let ui=await mount({...savedState(items),selection});
  action(ui,'exact-results',items[0].id,'different').click();await until(()=>ui.saved?.items[0].manualClassification?.persistent);
  action(ui,'excluded-results',items[1].id,'same').click();await until(()=>ui.saved?.items[1].manualClassification?.persistent);
  const localData=ui.localData;ui.close();
  // Start with entirely fresh listings: no previous session or manual fields.
  const fresh=()=>({...savedState(items.map(item=>({...item,title:'TEST refreshed title '+item.id,priceText:'$4.12'}))),referenceImage:image,selection:{...selection,id:'TEST next day',imageUrl:'https://img.kwcdn.com/other-gallery.jpg'}});
  ui=await mount(fresh(),{localData});
  assert.match(ui.get('exact-results').textContent,/789012/);assert.match(ui.get('excluded-results').textContent,/789011/);assert.match(ui.get('exact-results').textContent,/已记住你的分类/);assert.equal(ui.requests.length,0);
  assert.match(ui.get('exact-results').textContent,/\$4.12/);assert.equal((await exportData(ui)).products[1].manualClassification.referenceKey,'goods:601123456789900');ui.close();
  ui=await mount({...fresh(),selection:{...selection,productId:'601123456789901'}},{localData});
  assert.equal(ui.get('exact-results').querySelector('.product').dataset.productId,items[0].id);assert.doesNotMatch(ui.get('exact-results').textContent,/已记住/);ui.close();
  const otherSource={...fresh(),items:items.map(item=>({...item,salesSource:'temu-visible'}))};ui=await mount(otherSource,{localData});
  assert.equal(ui.get('exact-results').querySelector('.product').dataset.productId,items[0].id);assert.doesNotMatch(ui.get('exact-results').textContent,/已记住/);ui.close();
});

test('legacy corrections migrate once, and restoring automation cancels the memory even when an old session reappears',async()=>{
  const legacyItem={...makeItem('601123456789013','different'),manualClassification:{source:'user',decision:'same',updatedAt:'2026-10-16T01:00:00Z'}};
  const legacy=savedState([legacyItem]);let ui=await mount(legacy);
  assert.match(ui.get('exact-results').textContent,/已记住你的分类/);
  const localData=ui.localData,key=Object.keys(localData)[0];assert.equal(localData[key].entries[candidateMemoryKey(legacyItem)].updatedAt,'2026-10-16T01:00:00.000Z');
  action(ui,'exact-results',legacyItem.id,'restore').click();await until(()=>ui.saved&&!ui.saved.items[0].manualClassification);
  assert.equal(localData[key].entries[candidateMemoryKey(legacyItem)].decision,'automatic');ui.close();
  ui=await mount(legacy,{localData});assert.equal(ui.get('exact-results').children.length,0);assert.equal(ui.get('excluded-results').children.length,1);assert.equal(ui.messages.filter(message=>message.type==='manual-memory-update').length,0);ui.close();
});

test('failed durable writes visibly roll back both a changed classification and a cancelled remembered correction',async()=>{
  const item=makeItem('601123456789014'),saved=savedState([item]),referenceKey=await referenceMemoryKey(saved),key=memoryStorageKey(referenceKey);
  const localData={[key]:{schema:1,referenceKey,revision:1,entries:{[candidateMemoryKey(item)]:{source:'user',decision:'different',updatedAt:'2026-10-16T01:00:00Z'}}}};
  const ui=await mount(saved,{localData,memoryFails:true});
  action(ui,'excluded-results',item.id,'same').click();await until(()=>ui.get('status').textContent.includes('人工调整未保存'));
  assert.equal(ui.get('exact-results').children.length,0);assert.equal(ui.saved.items[0].manualClassification.decision,'different');assert.match(ui.get('manual-memory-status').textContent,/TEST local quota/);
  action(ui,'excluded-results',item.id,'restore').click();await until(()=>ui.get('excluded-results').querySelector('[data-action="restore"]')?.disabled===false);
  assert.equal(ui.get('exact-results').children.length,0);assert.equal(localData[key].entries[candidateMemoryKey(item)].decision,'different');assert.equal(ui.saved.items[0].manualClassification.persistent,true);ui.close();
});

test('storage updates from another panel refresh classifications, reject older revisions and respect cleared extension memory',async()=>{
  const item=makeItem('601123456789015'),saved=savedState([item]),referenceKey=await referenceMemoryKey(saved),key=memoryStorageKey(referenceKey);
  const ui=await mount(saved),record={schema:1,referenceKey,revision:2,entries:{[candidateMemoryKey(item)]:{source:'user',decision:'different',updatedAt:'2026-10-16T01:00:00Z'}}};
  const change=value=>ui.changeListeners.forEach(listener=>listener({[key]:{newValue:value}},'local'));
  change(record);assert.equal(ui.get('exact-results').children.length,0);assert.match(ui.get('excluded-results').textContent,/已记住/);
  change({...record,revision:1,entries:{}});assert.equal(ui.get('exact-results').children.length,0);
  change(undefined);assert.equal(ui.get('exact-results').children.length,1);assert.doesNotMatch(ui.get('exact-results').textContent,/已记住/);ui.close();
});

test('simple result tabs keep one category visible, retain full details and support keyboard navigation and corrections',async()=>{
  const items=[makeItem('601123456789021'),makeItem('601123456789022','different'),makeItem('601123456789023','pending')];
  const ui=await mount(savedState(items));
  assert.equal(ui.get('welcome').hidden,true);assert.equal(ui.get('more-tools').hasAttribute('open'),false);assert.equal(ui.get('keyword-section').hasAttribute('open'),false);
  assert.equal(ui.get('matches-section').hidden,false);assert.equal(ui.get('excluded-section').hidden,true);assert.equal(ui.get('pending-section').hidden,true);
  assert.equal(ui.get('same-total').textContent,'1');assert.equal(ui.get('different-total').textContent,'1');assert.equal(ui.get('pending-total').textContent,'1');
  const card=ui.get('exact-results').querySelector('.product');assert.equal(card.querySelector('.product-more').hasAttribute('open'),false);assert.match(card.querySelector('.full-title').textContent,new RegExp(items[0].title));assert.ok(card.querySelector('.product-more .evidence-list'));assert.ok(card.querySelector('.product-actions [data-action="different"]'));
  ui.get('tab-different').click();assert.equal(ui.get('matches-section').hidden,true);assert.equal(ui.get('excluded-section').hidden,false);assert.equal(ui.get('excluded-section').open,true);
  action(ui,'excluded-results',items[1].id,'same').click();await until(()=>ui.saved?.items[1].manualClassification?.persistent);assert.equal(ui.get('same-total').textContent,'2');assert.equal(ui.get('different-total').textContent,'0');assert.equal(ui.get('excluded-empty').hidden,false);
  const key=new ui.window.Event('keydown',{cancelable:true});Object.defineProperty(key,'key',{value:'Home'});ui.get('tab-different').dispatchEvent(key);
  assert.equal(ui.get('tab-same').getAttribute('aria-selected'),'true');assert.equal(ui.get('matches-section').hidden,false);
  ui.get('tab-pending').click();assert.equal(ui.get('pending-section').hidden,false);assert.equal(ui.get('pending-section').open,true);assert.equal(ui.get('matches-section').hidden,true);assert.ok(ui.get('pending-toggle'));ui.close();
});

test('a new user sees a single upload path, then one start action, without an empty progress bar or expanded tools',async()=>{
  let ui=await mount({...savedState([]),referenceImage:''});assert.equal(ui.get('welcome').hidden,false);assert.equal(ui.get('reference').hidden,true);assert.equal(ui.get('analysis-progress').hidden,true);assert.equal(ui.get('provider-section').hidden,true);assert.equal(ui.get('results-section').hidden,true);assert.equal(ui.get('more-tools').hasAttribute('open'),false);ui.close();
  ui=await mount(savedState([]));assert.equal(ui.get('welcome').hidden,true);assert.equal(ui.get('analyze').hidden,false);assert.equal(ui.get('analyze').disabled,false);assert.equal(ui.get('analysis-progress').hidden,true);ui.close();
});

test('upload and login steps automatically reveal their next action without exposing all tools',async()=>{
  const base={...savedState([]),providerJob:{tabId:7,manualUpload:true}};let ui=await mount(base);
  assert.equal(ui.get('provider-section').hidden,false);assert.equal(ui.get('provider-section').open,true);assert.equal(ui.get('analyze').hidden,true);assert.match(ui.get('show-provider').textContent,/上传图片/);assert.match(ui.get('read-provider').textContent,/已上传/);assert.equal(ui.get('more-tools').hasAttribute('open'),false);ui.close();
  ui=await mount({...base,providerJob:{tabId:7,manualUpload:false},collection:{source:'provider',tabId:7,status:'paused',reason:'login',productIds:[],pageKeys:[]}});assert.equal(ui.get('provider-section').open,true);assert.match(ui.get('provider-label').textContent,/需要你处理/);assert.equal(ui.get('show-provider').hidden,false);assert.equal(ui.get('more-tools').hasAttribute('open'),false);ui.close();
});
