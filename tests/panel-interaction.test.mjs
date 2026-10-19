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
const savedState=items=>({referenceImage:image,referenceSpecs:{},profile:{name:'TEST reference'},referenceContext:{collectionRevision:'declared-product-v1',title:'TEST reference'},matchingPolicy:'title-groups-outline-v16',engineRevision:'native-512-fp32-v1',keywordPolicy:'best-sellers-v1',matchRevision:1,items,pages:[],keywords:[],selectedQueries:[],collectionHistory:[]});
const delay=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let i=0;i<400;i++){if(check())return;await delay();}assert.fail('UI did not reach expected state');}
let mountCount=0;
async function mount(saved,{compare,selection=null,provider=null,storageFails=false,localData={},memoryFails=false}={}){
  const {document,window}=parseHTML(html);globalThis.document=document;globalThis.window=window;
  let lastSaved=null,healthRequests=0;const requests=[],messages=[];
  const changeListeners=[];
  const local={get:async key=>({[key]:structuredClone(localData[key]),preferences:{onImageClick:'local'}}),set:async data=>{if(memoryFails)throw Error('TEST local quota');Object.assign(localData,structuredClone(data));for(const listener of changeListeners)listener(Object.fromEntries(Object.entries(data).map(([key,newValue])=>[key,{newValue:structuredClone(newValue)}])),'local');}};
  const memory=new ManualMemoryStore(local);
  globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{session:{get:async()=>({'temuMatch:1':structuredClone(saved),'temuSelection:1':selection}),set:async data=>{if(storageFails)throw Error('TEST quota');lastSaved=structuredClone(data['temuMatch:1']);}},local,onChanged:{addListener:fn=>changeListeners.push(fn)}},tabs:{create:()=>{throw Error('No navigation during UI adjustments');}},runtime:{sendMessage:async message=>{messages.push(message);if(message.type==='manual-memory-update'){try{return {ok:true,record:await memory.update(message)};}catch(error){return {ok:false,error:error.message};}}return {ok:true,data:provider};}}};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/prefetch'))return {ok:true,json:async()=>({ok:true})};
    if(url.endsWith('/health')){healthRequests++;return {ok:true,json:async()=>({engine:'local',engineRevision:'native-512-fp32-v1',model:{state:'ready',progress:100,message:'TEST ready'}})};}
    const body=JSON.parse(options.body);requests.push(body);
    const comparison=await compare?.(body,options.signal);
    return {ok:true,json:async()=>({ok:true,comparison:comparison||{status:'pending'}})};
  };
  await import('../extension/panel.js?interaction='+(++mountCount));
  return {document,window,requests,messages,localData,changeListeners,get healthRequests(){return healthRequests;},get saved(){return lastSaved;},get:(id)=>document.getElementById(id),close(){window.dispatchEvent(new window.Event('pagehide'));}};
}
const action=(ui,section,id,decision,source='provider-visible')=>ui.get(section).querySelector(`[data-product-id="${id}"][data-source="${source}"] [data-action="${decision}"]`);
async function exportData(ui){let blob;const original=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:test';};try{ui.get('export').click();return JSON.parse(await blob.text());}finally{URL.createObjectURL=original;}}

test('subject review overlaps at most three requests, preserves response identity and manual decisions, and saves every completion',async()=>{
  const items=Array.from({length:6},(_,i)=>{const item=makeItem('60112345678910'+i,'pending');delete item.subjectAttempt;return item;});
  const held=new Map();let active=0,peak=0;
  const ui=await mount(savedState(items),{compare:async body=>{
    assert.equal(body.phase,'subject-review');active++;peak=Math.max(peak,active);
    return new Promise(resolve=>held.set(body.candidateId,()=>{active--;resolve({status:'visual-match',evidence:['TEST response '+body.candidateId]});}));
  }});
  try{
    await until(()=>ui.requests.length===3);assert.equal(active,3);await delay();assert.equal(ui.requests.length,3);
    action(ui,'pending-results',ui.requests[0].candidateId,'different').click();await until(()=>ui.saved?.items.some(item=>item.manualClassification));
    held.get(ui.requests[2].candidateId)();await until(()=>ui.requests.length===4);
    held.get(ui.requests[1].candidateId)();held.get(ui.requests[0].candidateId)();await until(()=>ui.requests.length===6);
    for(const body of ui.requests.slice(3))held.get(body.candidateId)();
    await until(()=>ui.saved?.items.every(item=>item.subjectAttempt===1)&&!ui.get('analyze').disabled);
    assert.equal(peak,3);for(const item of ui.saved.items)assert.deepEqual(item.evidence,['TEST response '+item.id]);
    assert.equal(ui.saved.items.find(item=>item.id===ui.requests[0].candidateId).manualClassification.decision,'different');assert.equal(ui.get('same-total').textContent,'5');
  }finally{for(const release of held.values())release();ui.close();}
});

test('cancelling a parallel batch discards late replies and leaves queued and in-flight items unfinished',async()=>{
  const items=Array.from({length:6},(_,i)=>{const item=makeItem('60112345678920'+i,'pending');delete item.subjectAttempt;return item;});
  const held=[];const ui=await mount(savedState(items),{compare:body=>new Promise(resolve=>held.push(()=>resolve({status:'visual-match',evidence:['TEST late '+body.candidateId]})))});
  try{
    await until(()=>held.length===3);ui.get('cancel').click();for(const release of held)release();
    await until(()=>!ui.get('analyze').disabled);assert.equal(ui.requests.length,3);
    assert.ok(ui.saved.items.every(item=>item.status==='pending'&&item.subjectAttempt===undefined));
  }finally{for(const release of held)release();ui.close();}
});

test('one fatal parallel request pauses the batch without completing its peers or dispatching queued candidates',async()=>{
  const items=Array.from({length:6},(_,i)=>{const item=makeItem('60112345678930'+i,'pending');delete item.subjectAttempt;return item;});
  const held=[];const ui=await mount(savedState(items),{compare:()=>new Promise((resolve,reject)=>held.push({resolve,reject}))});
  try{
    await until(()=>held.length===3);held[1].reject(Object.assign(Error('TEST native lane exited'),{serviceUnavailable:true}));await delay();
    held[0].resolve({status:'visual-match'});held[2].resolve({status:'visual-match'});
    await until(()=>!ui.get('analyze').disabled);assert.equal(ui.requests.length,3);assert.ok(ui.saved.items.every(item=>item.status==='pending'&&item.subjectAttempt===undefined));
    assert.match(ui.get('status').textContent,/TEST native lane exited/);
  }finally{for(const row of held)row.resolve({status:'pending'});ui.close();}
});

test('moving from browser to native clears automatic evidence but keeps remembered user classifications',async()=>{
  const manual={...makeItem('601123456789091','different'),manualClassification:{source:'user',decision:'same',updatedAt:'2026-10-16T01:00:00Z'}};
  const automatic=makeItem('601123456789092','different');
  const ui=await mount({...savedState([manual,automatic]),engineRevision:'browser-wasm-old'},{compare:async body=>({status:body.phase==='subject-review'?'pending':'visual-match',evidence:['TEST new native evidence'],samePhoto:true})});
  try{
    await until(()=>ui.saved?.items[1].status==='visual-match');
    assert.equal(ui.saved.engineRevision,'native-512-fp32-v1');
    assert.equal(ui.saved.items[0].manualClassification.decision,'same');
    assert.equal(ui.saved.items[0].evidence.includes('TEST retained automatic evidence'),false);
    assert.equal(ui.get('same-total').textContent,'2');
  }finally{ui.close();}
});

test('each card exposes only its own sales and original keywords beside its image, while recommendations still require a match',async()=>{
  const first=makeItem('601123456789081'),otherSource=makeItem(first.id,'visual-match','temu-visible');
  const pending=makeItem('601123456789082','pending'),different=makeItem('601123456789083','different');
  const empty={...makeItem('601123456789084'),title:'',sales:parseSales('')};
  for(const [index,item]of [first,otherSource,pending,different].entries()){
    item.sales=parseSales((120+index)+' sold');
    item.productKeywords=Array.from({length:4},(_,word)=>({productId:item.id,query:`TEST source ${index} original phrase ${word} <literal>`,evidence:`Original field: TEST source ${index} original phrase ${word} <literal>`,pageUrl:'https://www.temaishuju.com/plugin/search-image?test-source='+index,capturedAt:item.capturedAt}));
  }
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copied;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{copied=value;}}}});
  const ui=await mount(savedState([first,otherSource,pending,different,empty]));
  try{
    for(const [index,item]of [first,otherSource,pending,different].entries()){
      const card=ui.document.querySelector(`.product[data-product-id="${item.id}"][data-source="${item.salesSource}"]`);
      const block=card.querySelector('.product-top .product-keywords');assert.ok(block);
      assert.equal(block.closest('.product-more'),null);assert.equal(card.querySelector('img').getAttribute('src'),item.imageUrl);
      assert.match(block.querySelector('.product-meta').textContent,new RegExp((120+index)+' sold'));
      assert.equal(block.querySelectorAll('.keyword-preview-row').length,3);
      assert.deepEqual([...block.querySelectorAll('.keyword-preview-text')].map(word=>word.textContent),item.productKeywords.slice(0,3).map(word=>word.query));
      assert.equal(block.querySelectorAll('.keyword-preview-text b').length,0);
      assert.equal(block.querySelector('.keyword-details').hasAttribute('open'),false);
      assert.equal(block.querySelectorAll('.keyword-source').length,4);assert.match(block.querySelector('.keyword-details').textContent,/原文证据/);
      assert.equal(block.querySelector('.keyword-source a').href,item.productKeywords[0].pageUrl);
      assert.doesNotMatch(block.textContent,new RegExp('TEST source '+((index+1)%4)+' original'));
    }
    const emptyCard=ui.document.querySelector(`.product[data-product-id="${empty.id}"]`);
    assert.match(emptyCard.querySelector('.product-keywords').textContent,/销量未展示/);assert.match(emptyCard.textContent,/暂无可读取/);
    assert.equal(emptyCard.querySelectorAll('.keyword-preview-row').length,0);
    const firstCard=ui.get('exact-results').querySelector(`[data-product-id="${first.id}"][data-source="provider-visible"]`);
    firstCard.querySelector('.keyword-preview-row button').click();await until(()=>copied);
    assert.equal(copied,first.productKeywords[0].query);assert.match(ui.get('status').textContent,/已复制关键词/);
    assert.equal(ui.get('keywords').querySelectorAll('.seller-entry').length,2);
    assert.doesNotMatch(ui.get('keywords').textContent,/TEST source [23] original/);
    const exported=await exportData(ui);assert.equal(exported.products[2].keywordEvidence.length,0);assert.deepEqual(exported.products[2].productKeywords,pending.productKeywords);
    action(ui,'exact-results',first.id,'different').click();await until(()=>ui.saved?.items[0].manualClassification);
    assert.equal(ui.get('keywords').querySelectorAll('.seller-entry').length,1);
    assert.match(ui.get('excluded-results').querySelector(`[data-product-id="${first.id}"] .keyword-preview`).textContent,/TEST source 0 original/);
    assert.equal(ui.requests.length,0);
  }finally{ui.close();if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;}
});

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

test('uncertain candidates are visible immediately and can be classified and restored, and storage failures remain visible',async()=>{
  const ui=await mount(savedState([makeItem('601123456789003','pending')]),{storageFails:true});
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
  assert.equal(ui.get('progress-title').textContent,'正在收集商品');assert.match(ui.get('progress-count').textContent,/已收集 1 \/ 最多 50/);assert.equal(ui.get('progress-percent').textContent,'2%');
  ui.get('stop-collection').click();assert.equal(ui.get('progress-percent').textContent,'100%');assert.match(ui.get('progress-count').textContent,/已完成核对 1 \/ 1/);ui.close();
});

test('subject progress counts completed responses, keeps in-flight user corrections, and pauses below 100%',async()=>{
  const pending=[makeItem('601123456789005','pending'),makeItem('601123456789006','pending')];pending.forEach(item=>delete item.subjectAttempt);
  const deferred=[];
  const ui=await mount(savedState(pending),{compare:(body,signal)=>new Promise((resolve,reject)=>{
    if(body.phase!=='subject-review'){resolve({status:'pending',samePhoto:false,imageSimilarity:.2});return;}
    deferred.push({body,resolve});signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
  })});
  await until(()=>deferred.length===2);
  assert.equal(ui.get('progress-title').textContent,'正在核对商品主体');assert.equal(ui.get('progress-bar').getAttribute('aria-valuenow'),'0');assert.match(ui.get('progress-count').textContent,/0 \/ 2/);
  action(ui,'pending-results',pending[0].id,'same').click();
  assert.equal(ui.get('progress-percent').textContent,'50%');
  deferred[0].resolve({status:'different',evidence:['TEST automatic difference']});await until(()=>ui.saved?.items[0].subjectAttempt===1);
  assert.equal(ui.saved.items[0].status,'different');assert.equal(ui.saved.items[0].manualClassification.decision,'same');assert.equal(ui.get('exact-results').children.length,1);
  ui.get('cancel').click();await until(()=>ui.get('cancel').hidden);
  assert.equal(ui.get('progress-title').textContent,'核对已暂停');assert.equal(ui.get('progress-percent').textContent,'50%');assert.equal(ui.saved.items[1].subjectAttempt,undefined);
  assert.equal(ui.get('resume-analysis').hidden,false);assert.equal(ui.get('more-tools').hasAttribute('open'),false);
  ui.get('resume-analysis').click();await until(()=>deferred.length===3);
  assert.equal(deferred[2].body.candidateId,pending[1].id);
  deferred[2].resolve({status:'pending',evidence:['TEST inconclusive']});await until(()=>ui.get('cancel').hidden);
  assert.equal(ui.get('progress-title').textContent,'核对完成');assert.equal(ui.get('progress-percent').textContent,'100%');assert.match(ui.get('progress-totals').textContent,/无法确认 1/);assert.equal(ui.saved.items[0].manualClassification.decision,'same');ui.close();
});

test('a new selection during an awaited diagnostic save cannot receive the previous query products',async()=>{
  const originalInterval=globalThis.setInterval;let tickProvider,release,ui;
  globalThis.setInterval=(callback,ms,...args)=>{if(ms===2000)tickProvider=callback;return originalInterval(callback,ms,...args);};
  try{
    const imageUrl='https://img.kwcdn.com/old-query.jpg';
    const saved={...savedState([]),providerJob:{tabId:7,expectedImageUrl:imageUrl,submittedInput:{imageUrl,title:'Old query'}},collection:null};
    const provider={state:'results',queryImageUrl:imageUrl,pageUrl:'https://www.temaishuju.com/plugin/search-image?old',capturedAt:'2026-10-17T00:00:00Z',products:[makeItem('601123456789099')],keywords:[]};
    ui=await mount(saved,{provider});const originalSet=chrome.storage.session.set;
    chrome.storage.session.set=async data=>{await originalSet(data);if(data['temuMatch:1'].imageSearchDiagnostics?.observations?.length&&!release)await new Promise(resolve=>{release=resolve;});};
    tickProvider();await until(()=>release);
    ui.changeListeners[0]({'temuSelection:1':{newValue:{id:'new-during-old-save',windowId:1,imageUrl:image,title:'New reference'}}},'session');
    release();await until(()=>ui.saved?.selection?.id==='new-during-old-save');await delay();await delay();
    assert.equal(ui.saved.items.length,0);assert.equal(ui.get('exact-results').children.length,0);assert.equal(ui.get('pending-results').children.length,0);
  }finally{release?.();ui?.close();globalThis.setInterval=originalInterval;}
});

test('pausing cancels the native request and health polling does not resume work until the user continues',async()=>{
  const originalInterval=globalThis.setInterval;let tickHealth,ui;
  globalThis.setInterval=(callback,ms,...args)=>{if(ms===5000)tickHealth=callback;return originalInterval(callback,ms,...args);};
  try{
    const item=makeItem('601123456789098','pending');delete item.subjectAttempt;
    ui=await mount(savedState([item]),{compare:(body,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}))});
    await until(()=>ui.requests.length>0);ui.get('cancel').click();await until(()=>ui.get('cancel').hidden);
    const before=ui.healthRequests;assert.equal(typeof tickHealth,'function');await tickHealth();assert.equal(ui.healthRequests,before);assert.match(ui.get('service-status').textContent,/识别已暂停/);
    ui.get('resume-analysis').click();await until(()=>ui.requests.length>1);assert.equal(ui.get('cancel').hidden,false);
  }finally{ui?.close();globalThis.setInterval=originalInterval;}
});

test('a dropped connection shows recovery, retains progress and retries the same unfinished subject without a click',async()=>{
  const item=makeItem('601123456789007','pending');delete item.subjectAttempt;
  let attempts=0,release;
  const ui=await mount(savedState([item]),{compare:()=>{if(++attempts===1)throw new TypeError('TEST connection failure');return new Promise(resolve=>{release=resolve;});}});
  try{
    await until(()=>ui.get('progress-title').textContent==='后台正在自动恢复');
    assert.equal(ui.get('progress-percent').textContent,'0%');assert.equal(ui.get('exact-results').children.length,0);assert.equal(ui.get('service-help').hidden,false);
    await until(()=>release);release({status:'visual-match',evidence:['TEST recovered native subject']});
    await until(()=>ui.saved?.items[0].status==='visual-match'&&ui.get('cancel').hidden);
    assert.equal(ui.get('progress-percent').textContent,'100%');assert.equal(attempts,2);assert.equal(ui.saved.items[0].id,item.id);
  }finally{release?.({status:'pending'});ui.close();}
});

test('an extended service outage never completes the product and health recovery resumes it without resetting results',async()=>{
  const originalInterval=globalThis.setInterval;let tickHealth,ui,offline=true;
  globalThis.setInterval=(callback,ms,...args)=>{if(ms===5000)tickHealth=callback;return originalInterval(callback,ms,...args);};
  try{
    const item=makeItem('601123456789090','pending');delete item.subjectAttempt;
    ui=await mount(savedState([item]),{compare:()=>{if(offline)throw Object.assign(Error('TEST temporary service outage'),{serviceUnavailable:true});return {status:'visual-match'};}});
    await until(()=>ui.saved?.items[0].serviceInterrupted&&ui.get('cancel').hidden);
    assert.equal(ui.get('progress-percent').textContent,'0%');assert.equal(ui.saved.items[0].subjectAttempt,undefined);assert.equal(ui.saved.items[0].status,'pending');
    offline=false;await tickHealth();await until(()=>ui.saved?.items[0].status==='visual-match');
    assert.equal(ui.saved.items[0].priceText,item.priceText);assert.equal(ui.saved.items[0].title,item.title);
  }finally{ui?.close();globalThis.setInterval=originalInterval;}
});

test('a failed image download can be rechecked without retaining its old error or losing the captured product fields',async()=>{
  const item=makeItem('601123456789097','pending');delete item.autoAttempt;delete item.subjectAttempt;let fail=true;
  const ui=await mount(savedState([item]),{compare:()=>{if(fail)throw Error("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");return {status:'visual-match',samePhoto:true,imageSimilarity:1,evidence:['TEST recovered image']};}});
  try{
    await until(()=>ui.saved?.items[0].priorityError&&ui.get('cancel').hidden);assert.equal(ui.saved.items[0].status,'pending');assert.equal(ui.get('exact-results').children.length,0);
    fail=false;ui.get('compare-collected').click();await until(()=>ui.saved?.items[0].status==='visual-match'&&ui.get('cancel').hidden);
    assert.equal(ui.saved.items[0].priorityError,undefined);assert.equal(ui.saved.items[0].title,item.title);assert.equal(ui.saved.items[0].priceText,item.priceText);assert.equal(ui.get('exact-results').children.length,1);
  }finally{ui.close();}
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
  const items=[makeItem('601123456789021'),makeItem('601123456789022','different'),...Array.from({length:7},(_,i)=>makeItem(String(601123456789023+i),'pending'))];
  const ui=await mount(savedState(items));
  assert.equal(ui.get('welcome').hidden,true);assert.equal(ui.get('more-tools').hasAttribute('open'),false);assert.equal(ui.get('keyword-section').hasAttribute('open'),false);
  assert.equal(ui.get('matches-section').hidden,false);assert.equal(ui.get('excluded-section').hidden,true);assert.equal(ui.get('pending-section').hidden,true);
  assert.equal(ui.get('same-total').textContent,'1');assert.equal(ui.get('different-total').textContent,'1');assert.equal(ui.get('pending-total').textContent,'7');
  const card=ui.get('exact-results').querySelector('.product');assert.equal(card.querySelector('.product-more').hasAttribute('open'),false);assert.match(card.querySelector('.full-title').textContent,new RegExp(items[0].title));assert.ok(card.querySelector('.product-more .evidence-list'));assert.ok(card.querySelector('.product-actions [data-action="different"]'));
  ui.get('tab-different').click();assert.equal(ui.get('matches-section').hidden,true);assert.equal(ui.get('excluded-section').hidden,false);assert.equal(ui.get('excluded-section').open,true);
  action(ui,'excluded-results',items[1].id,'same').click();await until(()=>ui.saved?.items[1].manualClassification?.persistent);assert.equal(ui.get('same-total').textContent,'2');assert.equal(ui.get('different-total').textContent,'0');assert.equal(ui.get('excluded-empty').hidden,false);
  const key=new ui.window.Event('keydown',{cancelable:true});Object.defineProperty(key,'key',{value:'Home'});ui.get('tab-different').dispatchEvent(key);
  assert.equal(ui.get('tab-same').getAttribute('aria-selected'),'true');assert.equal(ui.get('matches-section').hidden,false);
  ui.get('tab-pending').click();assert.equal(ui.get('pending-section').hidden,false);assert.equal(ui.get('pending-section').open,true);assert.equal(ui.get('matches-section').hidden,true);assert.equal(ui.get('pending-results').querySelectorAll('.product').length,7);assert.equal(ui.get('pending-toggle'),null);ui.get('result-sort').dispatchEvent(new ui.window.Event('change'));assert.equal(ui.get('pending-results').querySelectorAll('.product').length,7);ui.close();
});

test('price directions reorder captured amounts within their currency or printed symbol, keep missing prices last and retain details',async()=>{
  const values=[['$8.00','unverified'],['$2.72','unverified'],['$2.72','unverified'],['CA$9.00','unverified'],['CA$1.50','unverified'],['$0.00','us'],['$4.00 – $7.00','us'],['','us'],['预估 $0.01','us']];
  const items=values.map(([priceText,market],i)=>({...makeItem(String(601123456789080+i)),priceText,market}));
  const ui=await mount(savedState(items));
  try{
    const select=ui.get('result-sort'),ids=()=>[...ui.get('exact-results').querySelectorAll('.product')].map(card=>card.dataset.productId);
    assert.deepEqual([...select.querySelectorAll('option')].map(option=>option.textContent),['匹配程度优先','价格从低到高','价格从高到低','销量优先（相同口径）']);
    const choose=value=>{for(const option of select.querySelectorAll('option')){option.removeAttribute('selected');if(option.value===value)option.setAttribute('selected','');}select.dispatchEvent(new ui.window.Event('change'));};
    choose('price');assert.deepEqual(ids(),[1,2,0,4,3,5,6,7,8].map(i=>items[i].id));
    choose('price-desc');assert.deepEqual(ids(),[0,1,2,3,4,6,5,7,8].map(i=>items[i].id));
    assert.equal(ui.get('exact-results').querySelectorAll('.price-group').length,4);
    const card=ui.get('exact-results').querySelector(`[data-product-id="${items[1].id}"]`);assert.doesNotMatch(card.querySelector('.product-top').textContent,/页面显示价|币种未确认/);assert.match(card.querySelector('.product-more').textContent,/页面显示价 · 币种未确认/);
    const exported=await exportData(ui);assert.deepEqual(exported.products.map(item=>item.priceText),values.map(([raw])=>raw));assert.equal(exported.products.find(item=>item.id===items[1].id).market,'unverified');
  }finally{ui.close();}
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

test('hover and keyboard previews reuse the captured image, stay inside a narrow viewport and close when their product is hidden',async()=>{
  const items=[makeItem('601123456789031'),makeItem('601123456789032','different')],ui=await mount(savedState(items));
  const rect={left:30,right:108,top:500,bottom:594},image=ui.get('exact-results').querySelector('img'),proto=Object.getPrototypeOf(image),original=Object.getOwnPropertyDescriptor(proto,'getBoundingClientRect');
  const emit=(target,type,properties={})=>{const event=new ui.window.Event(type,{bubbles:true});Object.assign(event,properties);target.dispatchEvent(event);};
  try{
    proto.getBoundingClientRect=()=>rect;ui.get('image-preview').getBoundingClientRect=()=>({height:0});ui.window.innerWidth=390;ui.window.innerHeight=840;
    emit(image,'mouseover',{clientX:60,clientY:540});
    assert.equal(ui.get('image-preview').hidden,false);assert.equal(ui.get('image-preview-image').getAttribute('src'),items[0].imageUrl);assert.equal(ui.get('image-preview-caption').textContent,items[0].title);
    assert.equal(ui.get('image-preview').style.width,'366px');assert.ok(parseFloat(ui.get('image-preview').style.left)>=12);assert.ok(parseFloat(ui.get('image-preview').style.top)>=12);
    emit(ui.get('result-sort'),'change');assert.equal(ui.get('image-preview').hidden,false,'ordinary progress/price redraw keeps the same hovered product');
    ui.get('tab-different').click();assert.equal(ui.get('image-preview').hidden,true);assert.equal(ui.get('image-preview-image').hasAttribute('src'),false);
    const other=ui.get('excluded-results').querySelector('img');emit(other,'mouseover',{clientX:60,clientY:540});assert.equal(ui.get('image-preview-image').getAttribute('src'),items[1].imageUrl);
    emit(ui.document,'scroll');assert.equal(ui.get('image-preview').hidden,true);
    Object.defineProperty(ui.document,'activeElement',{value:other,configurable:true});emit(other,'focusin');emit(ui.document,'scroll');assert.equal(ui.get('image-preview').hidden,false,'keyboard auto-scroll must not cancel its own preview');
    emit(ui.document,'keydown',{key:'Escape'});assert.equal(ui.get('image-preview').hidden,true);
    emit(other,'mouseover',{clientX:60,clientY:540});emit(other,'mouseout');assert.equal(ui.get('image-preview').hidden,true);
    emit(other,'focusin');emit(ui.window,'resize');assert.equal(ui.get('image-preview').hidden,true);
    assert.equal(ui.requests.length,0);assert.equal(ui.messages.length,0,'preview cannot open or collect product pages');
  }finally{if(original)Object.defineProperty(proto,'getBoundingClientRect',original);else delete proto.getBoundingClientRect;ui.close();}
});

test('collapsing results reveals keywords, keeps all records and stays collapsed while classifications update',async()=>{
  const items=[makeItem('601123456789041'),makeItem('601123456789042'),makeItem('601123456789043','different')],saved=savedState(items),ui=await mount(saved);
  assert.equal(ui.get('results-body').hidden,false);ui.get('toggle-results').click();
  assert.equal(ui.get('results-body').hidden,true);assert.equal(ui.get('toggle-results').getAttribute('aria-expanded'),'false');assert.equal(ui.get('toggle-results').textContent,'展开列表');assert.equal(ui.get('keyword-section').open,true);assert.match(ui.get('results-collapsed-note').textContent,/已收起 3 条/);assert.equal(ui.get('exact-results').children.length,2);
  const referenceKey=await referenceMemoryKey(saved),key=memoryStorageKey(referenceKey),record={schema:1,referenceKey,revision:1,entries:{[candidateMemoryKey(items[0])]:{source:'user',decision:'different',updatedAt:'2026-10-17T01:00:00Z'}}};
  ui.changeListeners.forEach(listener=>listener({[key]:{newValue:record}},'local'));
  assert.equal(ui.get('results-body').hidden,true);assert.equal(ui.get('same-total').textContent,'1');assert.equal(ui.get('different-total').textContent,'2');assert.match(ui.get('result-total').textContent,/3 条/);
  const exported=await exportData(ui);assert.equal(exported.products.length,3);assert.equal(exported.products[0].effectiveStatus,'manual-different');assert.equal(exported.products[0].title,items[0].title);
  ui.get('toggle-results').click();assert.equal(ui.get('results-body').hidden,false);assert.equal(ui.get('toggle-results').getAttribute('aria-expanded'),'true');assert.equal(ui.get('tab-same').getAttribute('aria-selected'),'true');assert.equal(ui.get('exact-results').children.length,1);assert.equal(ui.requests.length,0);ui.close();
});
