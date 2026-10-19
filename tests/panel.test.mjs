import {installEngineWorkerFixture} from './engine-worker-fixture.mjs';
installEngineWorkerFixture();
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {localSpecChecks,decideProductMatch} from '../shared/core.mjs';
import {titleMatchEvidence} from '../shared/title-match.mjs';
import {groupedProductReview} from '../server/match-flow.mjs';
const {document,window}=parseHTML(await readFile(new URL('../extension/panel.html',import.meta.url),'utf8'));
globalThis.document=document;globalThis.window=window;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const saved={referenceImage:image,referenceSpecs:{},profile:{name:'Saved product',keywords:['legacy invented keyword']},keywords:['legacy invented keyword'],selectedQueries:['legacy invented keyword'],items:[],pages:[],lastRun:null};
const fixture={pageUrl:'https://www.temu.com/search_result.html?search_key=blue+bottle',capturedAt:'2026-10-08T05:00:00.000Z',challenge:false,products:[{id:'601123456789001',url:'https://www.temu.com/goods.html?goods_id=601123456789001',title:'Fixture blue bottle',imageUrl:'https://img.kwcdn.com/fixture.jpg',rawText:'Fixture blue bottle $5.99 10K+ sold',detailsText:'Fixture blue bottle',priceText:'$5.99',market:'us',capturedAt:'2026-10-08T05:00:00.000Z'}]};
const storageListeners=[],createdTabs=[],tabUpdates=[];
let providerFixture=null;
let referenceFixture=null,comparisonRequests=0,lastSaved=null,batchSize=12,blockComparisons=false,blockedRequests=0;
let stagedFixture=false;
let fastMock=false;
let attentionMock=false;
let instanceMock=false;
let inferredMock=false;
let outlineMock=false;
const phases=[];
const specText='Brand: Acme; Model: A12; Material: silicone; Capacity: 500ml; Quantity: 1pc';
globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{onChanged:{addListener:fn=>storageListeners.push(fn)},session:{get:async()=>({temuMatch:saved}),set:async value=>{lastSaved=value['temuMatch:1'];}},local:{get:async()=>({preferences:{maxCandidates:batchSize}}),set:async()=>{}}},tabs:{create:async options=>{createdTabs.push(options);return{id:3};},query:async()=>[{id:1}],get:async()=>({status:'complete'}),remove:async()=>{},update:async(tabId,options)=>{tabUpdates.push({tabId,...options});}},runtime:{sendMessage:async message=>({ok:true,data:message.type==='collect-provider'?providerFixture:referenceFixture||fixture}),openOptionsPage:async()=>{}}};
globalThis.fetch=async(url,options)=>{
  let json;
  if(url.endsWith('/health'))json={engine:'local',configured:true,model:{state:'ready',message:'本地识别已就绪',progress:100}};
  else if(url.endsWith('/image'))json={ok:true,dataUrl:image};
  else if(url.endsWith('/compare')){
    comparisonRequests++;
    const body=JSON.parse(options.body);
    phases.push(body);
    if(blockComparisons){blockedRequests++;await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});});}
    const samePhoto=Boolean(referenceFixture)&&(!stagedFixture||body.imageUrl.includes('same-photo'));
    const comparison={visual:samePhoto?'same_photo':'uncertain',samePhoto,imageSimilarity:samePhoto?1:.4,checks:localSpecChecks(body.referenceSpecs,body.candidateText),evidence:['图片比对'],differences:[]};
    if(stagedFixture&&body.phase==='subject-review'){if(fastMock)comparison.fastMatch={matched:true};else comparison.subject={matched:true};}
    if(attentionMock&&body.phase==='subject-review')comparison.subject={matched:true,valid:true,subjectSimilarity:.99,localSimilarity:.98,colorSimilarity:.99,attention:{applied:true,reason:'人体识别与颜色共同支持的区域已降权'}};
    if(instanceMock&&body.phase==='subject-review'){comparison.subject=null;comparison.instanceMatch={matched:true,scope:'visible-product-instance'};}
    if(inferredMock&&body.phase==='subject-review'){
      comparison.subject={matched:false,valid:true,subjectSimilarity:.7};comparison.instanceMatch=null;comparison.fastMatch=null;
      Object.assign(comparison,await groupedProductReview({titleEvidence:titleMatchEvidence(body.referenceTitle,body.candidateTitle),review:async()=>({...comparison,...decideProductMatch(comparison,body.referenceSpecs,body.candidateText)}),colors:async()=>({valid:true,similarity:.9}),referenceSpecs:body.referenceSpecs,candidateText:body.candidateText}));
    }
    if(outlineMock&&body.phase==='subject-review'){
      comparison.subject={matched:false,valid:true,subjectSimilarity:.7};comparison.instanceMatch=null;comparison.fastMatch=null;
      Object.assign(comparison,await groupedProductReview({titleEvidence:titleMatchEvidence(body.referenceTitle,body.candidateTitle),review:async()=>({...comparison,...decideProductMatch(comparison,body.referenceSpecs,body.candidateText)}),colors:async()=>({valid:true,similarity:.4}),outlines:async()=>({revision:'subject-outline-v1',valid:true,matched:true,iou:.95,boundaryCoverage:.96,similarity:.95,orientation:{mirror:true,rotation:12},reason:'TEST subject outline supplement'}),referenceSpecs:body.referenceSpecs,candidateText:body.candidateText}));
    }
    json={ok:true,comparison:body.phase==='image-priority'?{samePhoto,imageSimilarity:comparison.imageSimilarity,priorityScore:samePhoto?0:1,subject:{subjectSimilarity:1}}:{...comparison,...decideProductMatch(comparison,body.referenceSpecs,body.candidateText),matchStage:body.phase==='subject-review'?'subject-review':'page-image'}};
  }else throw new Error('Unexpected test request '+url);
  return {ok:true,json:async()=>json};
};
await import('../extension/panel.js');
async function settle(){for(let i=0;i<40;i++)await new Promise(resolve=>setTimeout(resolve,1));}

test('the side panel restores uploads, reads real-page adapter data and excludes unverified products from recommendations',async()=>{
  assert.equal(document.getElementById('reference').hidden,false);
  assert.doesNotMatch(document.getElementById('keyword-section').textContent,/legacy invented keyword/);
  assert.equal(document.getElementById('retrieval-keywords').children.length,0);
  document.getElementById('collect').click();await settle();
  assert.match(document.getElementById('scope').textContent,/已读取 1 个商品/);
  assert.equal(document.getElementById('exact-results').children.length,0);
  assert.match(document.getElementById('pending-count').textContent,/1/);
  assert.equal(document.getElementById('exact-results').children.length,0);
  assert.ok(comparisonRequests>0);
  assert.match(document.getElementById('pending-results').textContent,/无法自动确认/);
  assert.doesNotMatch(document.getElementById('pending-results').textContent,/我已核对/);
  assert.equal(document.getElementById('pending-results').children.length,1);
  assert.match(document.getElementById('pending-results').textContent,/未列出/);
  document.getElementById('pending-toggle').click();await settle();
  assert.match(document.getElementById('pending-results').textContent,/已显示全部/);
  assert.match(document.getElementById('pending-results').textContent,/无法自动确认 · 不参与推荐/);
  document.getElementById('pending-toggle').click();await settle();
  assert.match(document.getElementById('pending-results').textContent,/未列出/);
  assert.match(document.getElementById('status').textContent,/同款匹配 0 个/);
  assert.equal(document.getElementById('cancel').hidden,true);
});

test('image results trigger automatic reference extraction, product confirmation and sourced keywords without human confirmation',async()=>{
  const imageUrl='https://img.kwcdn.com/new-product.jpg';
  referenceFixture={...fixture,pageUrl:'https://www.temu.com/goods.html?goods_id=601123456789002',detail:{...fixture.products[0],id:'601123456789002',detailsText:specText,variantAmbiguous:false}};
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-1',windowId:1,tabId:1,imageUrl,productId:'601123456789002',title:'Selected item'}}},'session');await settle();
  assert.equal(new URL(createdTabs[0].url).searchParams.get('url'),imageUrl);
  providerFixture={state:'results',pageUrl:createdTabs[0].url,queryImageUrl:'https://img.kwcdn.com/wrong.jpg',capturedAt:fixture.capturedAt,products:fixture.products,keywords:[]};
  document.getElementById('read-provider').click();await settle();
  assert.match(document.getElementById('status').textContent,/图片与本次选图不一致/);
  assert.equal(document.getElementById('pending-results').children.length,0);
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[{...fixture.products[0],detailsText:specText,salesFields:[{label:'已售出',value:'1200'}]}],keywords:[{query:'unassociated page keyword',metrics:[]}]};
  document.getElementById('read-provider').click();await settle();
  assert.equal(document.getElementById('exact-results').children.length,1);
  assert.match(document.getElementById('exact-results').textContent,/自动确认/);
  assert.match(document.getElementById('exact-results').textContent,/\$5.99/);
  assert.match(document.getElementById('exact-results').textContent,/复制完整标题/);
  assert.match(document.getElementById('exact-results').textContent,/特卖数据图搜/);
  assert.doesNotMatch(document.getElementById('keywords').textContent,/unassociated page keyword/);
  assert.equal(document.getElementById('retrieval-keywords').children.length,0);
  assert.equal(document.getElementById('spec-brand').value,'Acme');
  assert.ok(lastSaved.referenceContext.evidence.length===5);
  assert.match(document.getElementById('keywords').textContent,/Fixture blue bottle/);
  assert.match(document.getElementById('keywords').textContent,/商品标题原词/);
  assert.match(document.getElementById('keywords').textContent,/已售出：1200/);
  assert.equal(document.getElementById('keywords').querySelector('a').href,fixture.products[0].url);
  const previousRequests=comparisonRequests;
  document.getElementById('read-provider').click();await settle();
  assert.equal(comparisonRequests,previousRequests,'unchanged results are not repeatedly compared');
  // Replace the image through the same storage route; the previous product must disappear.
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-2',windowId:1,tabId:1,imageUrl:'https://img.kwcdn.com/other.jpg',title:'Other item'}}},'session');await settle();
  assert.equal(document.getElementById('pending-results').children.length,0);
  assert.doesNotMatch(document.getElementById('keywords').textContent,/Fixture blue bottle/);
  // Main image-search action navigates to image search; it never calls /profile.
  document.getElementById('analyze').click();await settle();
  assert.equal(new URL(createdTabs.at(-1).url).searchParams.get('url'),'https://img.kwcdn.com/other.jpg');
});

test('automatic matching processes subsequent batches without requiring button clicks',async()=>{
  batchSize=2;
  const imageUrl='https://img.kwcdn.com/batches.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-batches',windowId:1,tabId:1,imageUrl,productId:'601123456789002'}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:Array.from({length:7},(_,index)=>({...fixture.products[0],id:'60112345678901'+index,url:'https://www.temu.com/goods.html?goods_id=60112345678901'+index,title:'Batch seller '+index,detailsText:specText,salesFields:[{label:'已售出',value:String(index+1)}]}))};
  const startPhases=phases.length;
  document.getElementById('read-provider').click();await settle();
  assert.equal(document.getElementById('exact-results').children.length,7);
  assert.ok(lastSaved.items.every(item=>item.autoAttempt===lastSaved.matchRevision&&item.matchSource==='automated'));
  assert.equal(lastSaved.items.some(item=>item.matchSource==='human-confirmed'),false);
  assert.equal(phases.slice(startPhases).filter(body=>body.phase==='image-priority').length,7,'subsequent batches reuse the initial page-image checks');
});

test('an ambiguous reference SKU can show an appearance match and price, without claiming verified specifications',async()=>{
  referenceFixture={...referenceFixture,detail:{...referenceFixture.detail,variantAmbiguous:true}};
  const imageUrl='https://img.kwcdn.com/ambiguous.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-ambiguous',windowId:1,tabId:1,imageUrl,productId:'601123456789002'}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[{...providerFixture.products[0]}]};
  document.getElementById('read-provider').click();await settle();
  assert.equal(document.getElementById('exact-results').children.length,1);
  assert.equal(lastSaved.items[0].status,'visual-match');
  assert.match(document.getElementById('exact-results').textContent,/具体规格未绑定/);
  assert.doesNotMatch(document.getElementById('exact-results').textContent,/我已核对/);
});

test('changing the selected image cancels in-flight automatic checks and clears old product recommendations',async()=>{
  referenceFixture={...referenceFixture,detail:{...referenceFixture.detail,variantAmbiguous:false}};
  const imageUrl='https://img.kwcdn.com/cancel-old.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-cancel-old',windowId:1,tabId:1,imageUrl,productId:'601123456789002'}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl};
  blockComparisons=true;
  document.getElementById('read-provider').click();await settle();
  assert.ok(blockedRequests>0);
  const newImage='https://img.kwcdn.com/cancel-new.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-cancel-new',windowId:1,tabId:1,imageUrl:newImage,productId:'601123456789002'}}},'session');await settle();
  blockComparisons=false;
  assert.equal(lastSaved.referenceImage,newImage);assert.equal(lastSaved.items.length,0);
  assert.equal(document.getElementById('exact-results').children.length,0);
  assert.equal(document.getElementById('cancel').hidden,true);
});
test('page-image matching finishes first, ignores subject scores and reviews only unresolved candidates later',async()=>{
  batchSize=1;stagedFixture=true;
  const imageUrl='https://img.kwcdn.com/page-first-reference.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-stages',windowId:1,tabId:1,imageUrl,productId:'601123456789002'}}},'session');await settle();
  const product=(id,imageName)=>({...fixture.products[0],id,url:'https://www.temu.com/goods.html?goods_id='+id,imageUrl:'https://img.kwcdn.com/'+imageName+'.jpg',detailsText:specText,salesFields:[{label:'已售出',value:'1200'}]});
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[product('601123456789901','new-background'),product('601123456789902','same-photo')]};
  const start=phases.length;
  document.getElementById('read-provider').click();await settle();
  const calls=phases.slice(start),pageCalls=calls.filter(body=>body.phase==='page-match'),reviewCalls=calls.filter(body=>body.phase==='subject-review');
  assert.equal(pageCalls.length,2);
  assert.match(pageCalls[0].imageUrl,/same-photo/,'cached subject scores cannot outrank the original same-photo match');
  assert.equal(reviewCalls.length,1);
  assert.match(reviewCalls[0].imageUrl,/new-background/);
  assert.ok(calls.indexOf(reviewCalls[0])>Math.max(...pageCalls.map(body=>calls.indexOf(body))));
  assert.equal(lastSaved.items.find(item=>item.imageUrl.includes('same-photo')).matchStage,'page-image');
  assert.equal(lastSaved.items.find(item=>item.imageUrl.includes('new-background')).matchStage,'subject-review');
  assert.equal(document.getElementById('exact-results').children.length,2);
  assert.match(document.getElementById('exact-results').firstElementChild.textContent,/同图匹配|自动确认/);
  assert.equal(lastSaved.matchingPolicy,'title-groups-outline-v16');
});

test('automatic checks use captured images and card data without opening reference or candidate detail tabs',async()=>{
  referenceFixture={...fixture,detail:undefined,products:[]};batchSize=1;stagedFixture=true;
  const imageUrl='https://img.kwcdn.com/no-navigation-reference.jpg';
  const startTabs=createdTabs.length;
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-no-navigation',windowId:1,tabId:1,imageUrl,productId:'601123456789999'}}},'session');await settle();
  // Only the normal image-search entry opens. Reference data is unavailable;
  // it must not lead to a hidden reference product tab.
  assert.equal(createdTabs.length,startTabs+1);
  assert.equal(new URL(createdTabs.at(-1).url).hostname,'www.temaishuju.com');
  const product=(id,name)=>({...fixture.products[0],id,url:'https://www.temu.com/goods.html?goods_id='+id,title:'Captured seller '+name,imageUrl:'https://img.kwcdn.com/'+name+'.jpg',detailsText:undefined,priceText:'$8.25',salesFields:[{label:'已售出',value:'321'}]});
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[product('601123456789991','same-photo'),product('601123456789992','new-background')]};
  const startRequests=phases.length;
  document.getElementById('read-provider').click();await settle();
  assert.equal(createdTabs.length,startTabs+1,'no candidate detail tabs may be opened, even for high-similarity images');
  assert.equal(lastSaved.items.length,2);assert.equal(document.getElementById('exact-results').children.length,2);
  assert.ok(phases.slice(startRequests).some(body=>body.phase==='subject-review'),'subject review still runs on captured images');
  assert.ok(lastSaved.items.every(item=>item.title.startsWith('Captured seller ')&&item.price.raw==='$8.25'));
  assert.match(lastSaved.referenceContext.message,/不另开详情页/);
  const beforeRetry=createdTabs.length;
  document.getElementById('compare-collected').click();await settle();
  assert.equal(createdTabs.length,beforeRetry,'explicit rechecking also performs no browser navigation');
  const requestsBeforePrice=comparisonRequests;
  providerFixture={...providerFixture,products:providerFixture.products.map(product=>({...product,priceText:'$6.75'}))};
  document.getElementById('read-provider').click();await settle();
  assert.ok(lastSaved.items.every(item=>item.price.raw==='$6.75'));
  assert.match(document.getElementById('exact-results').textContent,/\$6.75/);
  assert.equal(comparisonRequests,requestsBeforePrice,'late price changes do not repeat image inference');
  assert.equal(createdTabs.length,beforeRetry);
});

test('same-photo listings stay fast and different pack counts continue image review',async()=>{
  batchSize=40;stagedFixture=true;
  const title='4pcs Rotating Vertical Toothpaste Squeezer Roller Tube Dispenser';
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title,rawText:title,detailsText:title,variantAmbiguous:false}};
  const imageUrl='https://img.kwcdn.com/same-photo-toothpaste.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-screenshot',windowId:1,tabId:1,imageUrl,productId:'601123456789999',title}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[
    {...fixture.products[0],title,detailsText:undefined,imageUrl,priceText:'$1.68',salesFields:[{label:'已售出',value:'485'}]},
    {...fixture.products[0],id:'601123456789992',url:'https://www.temu.com/goods.html?goods_id=601123456789992',title:'12 Pack Toothpaste Squeezer Roller',detailsText:undefined,imageUrl:'https://img.kwcdn.com/other-pack.jpg',priceText:'$2.63',salesFields:[{label:'已售出',value:'69'}]}
  ]};
  const start=phases.length;
  document.getElementById('read-provider').click();await settle();
  assert.equal(phases.slice(start).filter(body=>body.phase==='subject-review').length,1);
  assert.equal(lastSaved.items.find(item=>item.title.startsWith('12 Pack')).status,'visual-match');
  assert.equal(lastSaved.items.find(item=>item.title.startsWith('12 Pack')).packDifference.candidate,'12 Pack');
  assert.equal(document.getElementById('exact-results').children.length,2);
  assert.match(document.getElementById('exact-results').textContent,/\$1.68/);
  assert.match(document.getElementById('exact-results').textContent,/4pcs Rotating Vertical/);
});

test('prices remain readable while image inference is in progress without changing its input or opening pages',async()=>{
  providerFixture={...providerFixture,products:[...providerFixture.products,{...providerFixture.products[0],id:'601123456789993',url:'https://www.temu.com/goods.html?goods_id=601123456789993',imageUrl:'https://img.kwcdn.com/slow-new-photo.jpg'}]};
  blockComparisons=true;
  document.getElementById('read-provider').click();await settle();
  const requestsBefore=comparisonRequests,tabsBefore=createdTabs.length;
  assert.equal(document.getElementById('read-provider').disabled,false);
  assert.equal(document.getElementById('cancel').hidden,false);
  providerFixture={...providerFixture,products:providerFixture.products.map(product=>({...product,priceText:'$2.09'}))};
  document.getElementById('read-provider').click();await settle();
  assert.match(document.getElementById('exact-results').textContent,/\$2.09/);
  assert.equal(comparisonRequests,requestsBefore);assert.equal(createdTabs.length,tabsBefore);
  document.getElementById('cancel').click();await settle();blockComparisons=false;
});

test('fast confirmed appearance keeps the captured price, original title and product link',async()=>{
  fastMock=true;stagedFixture=true;
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title:'Reference glove',detailsText:'',rawText:'Reference glove',variantAmbiguous:false}};
  const imageUrl='https://img.kwcdn.com/fast-reference.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-fast-feature',windowId:1,tabId:1,imageUrl,productId:'601123456789999'}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[{...fixture.products[0],imageUrl:'https://img.kwcdn.com/new-background-fast.jpg',title:'Original seller glove title',detailsText:undefined,priceText:'$7.25'}]};
  document.getElementById('read-provider').click();await settle();
  assert.equal(document.getElementById('exact-results').children.length,1);
  assert.match(document.getElementById('exact-results').textContent,/快速图像核验/);
  assert.match(document.getElementById('exact-results').textContent,/Original seller glove title/);
  assert.match(document.getElementById('exact-results').textContent,/\$7.25/);
  assert.equal(document.getElementById('exact-results').querySelector('.product-actions a').href,fixture.products[0].url);
});

test('1pc and 2pcs comb links both appear after image confirmation with separate package prices',async()=>{
  stagedFixture=true;fastMock=true;batchSize=40;
  const title='1pc Natural Sandalwood Comb Wide Tooth Hairdressing Comb';
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title,detailsText:title,rawText:title,variantAmbiguous:false}};
  const imageUrl='https://img.kwcdn.com/same-photo-comb.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-comb-packs',windowId:1,tabId:1,imageUrl,productId:'601123456789999',title}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[
    {...fixture.products[0],title,imageUrl,detailsText:undefined,priceText:'$1.83'},
    {...fixture.products[0],id:'601123456789992',url:'https://www.temu.com/goods.html?goods_id=601123456789992',title:'2pcs Natural Sandalwood Comb Wide-tooth Hair Comb',imageUrl:'https://img.kwcdn.com/comb-other-encoding.jpg',detailsText:undefined,priceText:'$3.91'}
  ]};
  const start=phases.length;
  document.getElementById('read-provider').click();await settle();
  const calls=phases.slice(start);
  assert.ok(calls.some(body=>body.phase==='subject-review'&&body.imageUrl.includes('comb-other')));
  assert.equal(document.getElementById('exact-results').children.length,2);
  const text=document.getElementById('exact-results').textContent;
  assert.match(text,/\$1.83/);assert.match(text,/\$3.91/);assert.match(text,/参考 1pc，此链接 2pcs/);
  assert.match(text,/未折算单件价/);
  assert.equal(lastSaved.items.find(item=>item.title.startsWith('2pcs')).status,'visual-match');
  assert.equal(document.getElementById('excluded-results').children.length,0);
});

test('focused results explain preserved images and still show the original price/title without opening detail pages',async()=>{
  stagedFixture=true;fastMock=false;attentionMock=true;
  const title='Natural wooden comb';
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title,detailsText:title,rawText:title,variantAmbiguous:false}};
  const imageUrl='https://img.kwcdn.com/reference-attention.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-attention',windowId:1,tabId:1,imageUrl,productId:'601123456789999',title}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[{...fixture.products[0],title:'Original comb seller title',imageUrl:'https://img.kwcdn.com/candidate-attention.jpg',priceText:'$5.25'}]};
  const before=createdTabs.length,start=phases.length;
  document.getElementById('read-provider').click();await settle();
  assert.equal(createdTabs.length,before);
  const text=document.getElementById('exact-results').textContent;
  assert.match(text,/商品区域加权特征/);assert.match(text,/图片中的手仍保留/);assert.match(text,/Original comb seller title/);assert.match(text,/\$5.25/);
  assert.equal(phases.slice(start).find(body=>body.phase==='subject-review').referenceTitle,title);
});

test('captured title attributes and explicit brand/model fields stay visible independently of image confirmation',async()=>{
  stagedFixture=true;fastMock=false;attentionMock=false;
  referenceFixture={...referenceFixture,detail:{...referenceFixture.detail,title:'3 pairs Thick Latex Kitchen Gloves'}};
  const imageUrl='https://img.kwcdn.com/listing-fields-reference.jpg';
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-fields',windowId:1,tabId:1,imageUrl,productId:'601123456789999'}}},'session');await settle();
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[{...fixture.products[0],title:'22pcs (11Pairs) Random Color Thick Latex Kitchen Gloves',imageUrl:'https://img.kwcdn.com/listing-fields-candidate.jpg',priceText:'$13.13',listingFields:[{label:'Brand',value:'Actual Brand'},{label:'Model',value:'G22'}]}]};
  const before=createdTabs.length;
  document.getElementById('read-provider').click();await settle();
  const card=document.getElementById('exact-results').firstElementChild;
  assert.match(card.textContent,/22pcs \(11Pairs\)/);assert.match(card.textContent,/材质 Latex/);assert.match(card.textContent,/Actual Brand/);assert.match(card.textContent,/G22/);assert.match(card.textContent,/标题原文/);assert.match(card.textContent,/品牌不单独决定同款/);assert.match(card.textContent,/\$13.13/);
  const imageEvidence=[...card.querySelectorAll('details')].find(detail=>detail.querySelector('summary')?.textContent==='查看核对依据');
  assert.doesNotMatch(imageEvidence.textContent,/上传产品的品牌|上传产品的型号/);
  assert.equal(lastSaved.items[0].checks.find(check=>check.key==='model').candidateValue,'G22');
  assert.equal(createdTabs.length,before);
});

test('multi-pack confirmation reuses only bound existing product images, captures explicit metadata and opens no detail pages',async()=>{
 stagedFixture=true;fastMock=false;attentionMock=false;instanceMock=true;
 const title='3 pairs Green Kitchen Gloves',imageUrl='https://img.kwcdn.com/gallery-main.jpg',gallery=['https://img.kwcdn.com/gallery-main.jpg','https://img.kwcdn.com/gallery-front.jpg'];
 referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title,detailsText:title,rawText:title,variantAmbiguous:true,declaredImageSource:'bound-current-product-gallery',verifiedImages:gallery,listingFields:[{label:'Model',value:'G22',source:'public-microdata'}]}};
 storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-gallery',windowId:1,tabId:1,imageUrl,productId:'601123456789999',title}}},'session');await settle();
 const before=createdTabs.length,start=phases.length;
 providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[{...fixture.products[0],title:'22pcs (11Pairs) Latex Gloves',imageUrl:'https://img.kwcdn.com/gallery-candidate.jpg',priceText:'$13.13'}]};
 document.getElementById('read-provider').click();await settle();
 const review=phases.slice(start).find(body=>body.phase==='subject-review');assert.deepEqual(review.referenceImages,gallery);assert.equal(review.referenceImageSource,'bound-current-product-gallery');assert.equal(review.referenceSpecs.model,'G22');
 assert.equal(createdTabs.length,before);assert.match(document.getElementById('exact-results').textContent,/图中完整实例已核验/);assert.match(document.getElementById('exact-results').textContent,/\$13.13/);assert.match(document.getElementById('exact-results').textContent,/22pcs \(11Pairs\)/);
});
test('reading an already open product enriches same-ID provider fields without moving price/title/sales to another source',async()=>{
 const before=createdTabs.length,original=providerFixture.products[0].title;
 referenceFixture={...fixture,pageUrl:fixture.products[0].url,detail:{...fixture.products[0],title:'Detail title',detailsText:'Brand: Current Brand; Model: D77; Material: latex',structuredSpecs:{brand:'Current Brand',model:'D77'},listingFields:[{label:'Brand',value:'Current Brand',source:'public-jsonld'}],priceText:'$2.22'}};
 document.getElementById('collect').click();await settle();
 const row=lastSaved.items.find(item=>item.id===fixture.products[0].id&&item.salesSource==='provider-visible');assert.equal(row.structuredSpecs.brand,'Current Brand');assert.equal(row.price.raw,'$13.13');assert.equal(row.title,original);assert.equal(row.detailSourceUrl,fixture.products[0].url);
 providerFixture={...providerFixture,products:providerFixture.products.map(item=>({...item,priceText:'$14.99'}))};document.getElementById('read-provider').click();await settle();
 const updated=lastSaved.items.find(item=>item.id===fixture.products[0].id&&item.salesSource==='provider-visible');assert.equal(updated.structuredSpecs.brand,'Current Brand');assert.equal(updated.price.raw,'$14.99');assert.equal(createdTabs.length,before);
});

test('both title groups are reviewed; only similar titles use post-review color and preserve price/title/link with sourced keywords',async()=>{
  stagedFixture=true;fastMock=false;attentionMock=false;instanceMock=false;inferredMock=true;
  const title='3 pairs Thick Latex Kitchen Gloves',imageUrl='https://img.kwcdn.com/title-first-reference.jpg';
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title,detailsText:title,rawText:title,variantAmbiguous:false}};
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-title-first',windowId:1,tabId:1,imageUrl,productId:'601123456789999',title}}},'session');await settle();
  const near={...fixture.products[0],id:'601123456789004',url:'https://www.temu.com/goods.html?goods_id=601123456789004',title:'22pcs (11Pairs) Thick Latex Kitchen Gloves',imageUrl:'https://img.kwcdn.com/title-near.jpg',priceText:'$13.13',salesFields:[{label:'已售出',value:'20000'}]};
  const unrelated={...near,id:'601123456789005',url:'https://www.temu.com/goods.html?goods_id=601123456789005',title:'Green Kitchen Water Bottle',imageUrl:'https://img.kwcdn.com/title-other.jpg'};
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[unrelated,near],keywords:[]};
  const before=createdTabs.length,start=phases.length;
  document.getElementById('read-provider').click();await settle();
  const requests=phases.slice(start);assert.equal(requests.find(body=>body.phase==='image-priority').imageUrl,near.imageUrl);
  assert.equal(requests.some(body=>body.phase==='subject-review'&&body.imageUrl===unrelated.imageUrl),true);
  const review=requests.find(body=>body.phase==='subject-review');assert.equal(review.candidateTitle,near.title);assert.equal(review.referenceTitle,title);
  const row=lastSaved.items.find(item=>item.id===near.id);assert.equal(row.status,'rule-match');assert.equal(row.price.raw,'$13.13');assert.equal(row.title,near.title);assert.equal(row.url,near.url);
  assert.match(document.getElementById('exact-results').textContent,/同款 · 标题相似 \/ 主体颜色相近/);assert.match(document.getElementById('exact-results').textContent,/主体细节未匹配/);
  assert.match(document.getElementById('count').textContent,/1 个主体颜色补充/);assert.ok(document.getElementById('keywords').querySelectorAll('a').length>0);assert.match(document.getElementById('keywords').textContent,/主体颜色补充同款/);
  assert.equal(lastSaved.items.find(item=>item.id===unrelated.id).status,'pending');assert.equal(createdTabs.length,before);
  inferredMock=false;
});

test('dissimilar titles still become matches when their subjects match, with no new product tabs',async()=>{
  stagedFixture=true;fastMock=false;attentionMock=false;instanceMock=false;inferredMock=false;
  const imageUrl='https://img.kwcdn.com/different-title-reference.jpg',title='Thick Latex Kitchen Gloves';
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title,detailsText:title,rawText:title,variantAmbiguous:false}};
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-different-title',windowId:1,tabId:1,imageUrl,productId:'601123456789999',title}}},'session');await settle();
  const candidate={...fixture.products[0],title:'Green Kitchen Water Bottle',imageUrl:'https://img.kwcdn.com/dissimilar-title-same-subject.jpg',priceText:'$3.75'};
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products:[candidate]};const before=createdTabs.length,start=phases.length;
  document.getElementById('read-provider').click();await settle();
  assert.ok(phases.slice(start).some(body=>body.phase==='subject-review'&&body.candidateTitle===candidate.title));
  assert.equal(lastSaved.items[0].status,'visual-match');assert.equal(lastSaved.items[0].titleEvidence.group,'dissimilar');assert.match(document.getElementById('exact-results').textContent,/\$3.75/);assert.equal(createdTabs.length,before);
});

test('outline-only fallback is labeled separately, keeps original price/title/link and participates in sourced sales keywords and export',async()=>{
  stagedFixture=true;fastMock=false;attentionMock=false;instanceMock=false;inferredMock=false;outlineMock=true;
  try{
    const imageUrl='https://img.kwcdn.com/outline-reference.jpg';
    referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title:'Captured reference gloves',detailsText:specText}};
    storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-outline',windowId:1,tabId:1,imageUrl,productId:'601123456789999'}}},'session');await settle();
    const candidate={...fixture.products[0],title:'Original captured contour listing, literal seller phrase',imageUrl:'https://img.kwcdn.com/outline-candidate.jpg',priceText:'$8.76',salesFields:[{label:'已售出',value:'120'}]};
    providerFixture={...providerFixture,state:'results',queryImageUrl:imageUrl,products:[candidate],keywords:[]};const before=createdTabs.length,start=phases.length;
    document.getElementById('read-provider').click();await settle();
    assert.equal(lastSaved.items[0].status,'outline-match');assert.equal(lastSaved.items[0].titleEvidence.group,'dissimilar');assert.equal(lastSaved.items[0].title,candidate.title);assert.equal(lastSaved.items[0].price.raw,'$8.76');assert.equal(lastSaved.items[0].url,candidate.url);assert.equal(createdTabs.length,before);
    assert.ok(phases.slice(start).some(body=>body.phase==='subject-review'));assert.match(document.getElementById('count').textContent,/1 个主体轮廓补充/);assert.match(document.getElementById('exact-results').textContent,/轮廓交并比 95%/);assert.match(document.getElementById('exact-results').textContent,/不是同款概率/);assert.match(document.getElementById('keywords').textContent,/主体轮廓补充同款/);
    let blob;const original=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:outline';};
    try{document.getElementById('export').click();const data=JSON.parse(await blob.text());assert.equal(data.matchingPolicy,'title-groups-outline-v16');assert.equal(data.products[0].outlineMatch.iou,.95);assert.equal(data.keywords[0].products[0].keywordEvidence[0].matchStatus,'outline-match');}finally{URL.createObjectURL=original;}
  }finally{outlineMock=false;}
});

test('image-search dispatch keeps the provider in the background with original inputs; login stays paused until explicitly viewed',async()=>{
  stagedFixture=false;fastMock=false;attentionMock=false;instanceMock=false;inferredMock=false;
  const title='3 pairs Thick Latex Kitchen Gloves',id='601123456789999',imageUrl='https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg';
  referenceFixture={...fixture,detail:{...fixture.products[0],id,title,detailsText:title,rawText:title,variantAmbiguous:false}};
  const before=createdTabs.length,requests=comparisonRequests,updates=tabUpdates.length;
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-real-input',windowId:1,tabId:1,imageUrl,productId:id,title:'商品图片'}}},'session');await settle();
  const url=new URL(createdTabs.at(-1).url);assert.equal(url.searchParams.get('url'),imageUrl);assert.equal(url.searchParams.get('title'),title);assert.equal(url.searchParams.get('goodsId'),id);assert.equal(createdTabs.length,before+1);assert.equal(comparisonRequests,requests);
  assert.equal(createdTabs.at(-1).active,false);assert.equal(createdTabs.at(-1).windowId,1);assert.equal(tabUpdates.length,updates);assert.equal(document.getElementById('show-provider').hidden,false);
  assert.equal(document.getElementById('provider-input').hidden,false);assert.equal(document.getElementById('provider-input-image').src,imageUrl);assert.match(document.getElementById('provider-input-title').textContent,/3 pairs Thick Latex Kitchen Gloves/);assert.equal(lastSaved.providerJob.submittedInput.titleSource,'captured-product');
  referenceFixture={...fixture,detail:undefined,products:[]};
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-card-title-fallback',windowId:1,tabId:1,imageUrl,productId:id,title:'Actual card cleaning gloves',titleSource:'product-title-element'}}},'session');await settle();assert.equal(new URL(createdTabs.at(-1).url).searchParams.get('title'),'Actual card cleaning gloves');
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-no-real-title',windowId:1,tabId:1,imageUrl,productId:id,title:'商品图片'}}},'session');await settle();assert.equal(new URL(createdTabs.at(-1).url).searchParams.has('title'),false);assert.match(document.getElementById('provider-status').textContent,/未读取到原标题/);assert.equal(comparisonRequests,requests);
  assert.ok(createdTabs.slice(before).every(tab=>tab.active===false));
  const previousProvider=providerFixture;providerFixture={state:'login',pageUrl:createdTabs.at(-1).url,message:'需要登录图搜页面',products:[]};
  document.getElementById('read-provider').click();await settle();assert.equal(lastSaved.collection.reason,'login');assert.equal(tabUpdates.length,updates);assert.match(document.getElementById('provider-status').textContent,/查看图搜页/);
  const tabCount=createdTabs.length;document.getElementById('show-provider').click();await settle();assert.deepEqual(tabUpdates.at(-1),{tabId:lastSaved.providerJob.tabId,active:true});assert.equal(createdTabs.length,tabCount);assert.equal(lastSaved.providerJob.submittedInput.imageUrl,imageUrl);
  const originalUpdate=chrome.tabs.update;try{chrome.tabs.update=async()=>{throw Error('No tab with id');};document.getElementById('show-provider').click();await settle();assert.match(document.getElementById('provider-status').textContent,/标签页可能已关闭/);assert.equal(createdTabs.length,tabCount);}finally{chrome.tabs.update=originalUpdate;providerFixture=previousProvider;}
});

test('Top10 renders ranked product links and per-link evidence, updates without rechecking images and exports all products',async()=>{
  stagedFixture=false;fastMock=false;attentionMock=false;instanceMock=false;inferredMock=false;batchSize=12;
  const imageUrl='https://img.kwcdn.com/top10-reference.jpg';
  referenceFixture={...fixture,detail:{...fixture.products[0],id:'601123456789999',title:'Top10 fixture reference',detailsText:specText,rawText:specText,variantAmbiguous:false}};
  storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-top10',windowId:1,tabId:1,imageUrl,productId:'601123456789999'}}},'session');await settle();
  const products=Array.from({length:12},(_,i)=>({...fixture.products[0],id:String(601123456789100+i),url:'https://www.temu.com/goods.html?goods_id='+String(601123456789100+i),title:'Top10 original seller '+i,salesFields:[{label:'已售出',value:String(100-i)}]}));
  products[0].productKeywords=[{productId:products[0].id,query:'Exact seller phrase',evidence:'关键词：Exact seller phrase',pageUrl:providerFixture.pageUrl,capturedAt:'2026-10-10T01:00:00Z'},{productId:products[1].id,query:'Other seller phrase',evidence:'Other seller phrase',pageUrl:providerFixture.pageUrl}];
  products.push({...products[11],id:'601123456789200',url:'https://www.temu.com/goods.html?goods_id=601123456789200',title:'Unknown sales original words',salesFields:[]});
  providerFixture={...providerFixture,queryImageUrl:imageUrl,products,keywords:[]};
  const beforeTabs=createdTabs.length;
  document.getElementById('read-provider').click();await settle();await settle();
  const entries=[...document.querySelectorAll('#keywords .seller-entry')];assert.equal(entries.length,10);
  assert.equal(entries[0].dataset.productId,products[0].id);assert.equal(entries[9].dataset.productId,products[9].id);
  assert.match(entries[0].textContent,/Exact seller phrase/);assert.match(entries[0].textContent,/商品页面关键词/);assert.match(entries[0].textContent,/原文证据/);assert.doesNotMatch(entries[0].textContent,/Other seller phrase/);assert.equal(entries[0].querySelector('a').href,products[0].url);
  assert.match(entries[1].textContent,/商品标题原词/);assert.match(document.getElementById('keyword-caption').textContent,/Top10/);
  const cards=[...document.querySelectorAll('#exact-results .product')];assert.equal(cards.length,13);assert.ok(cards.every(card=>card.querySelector('.product-keywords')));
  assert.match(cards.find(card=>card.textContent.includes('Unknown sales original words')).querySelector('.product-keywords').textContent,/销量未知/);
  const beforeRequests=comparisonRequests;
  providerFixture={...providerFixture,capturedAt:'2026-10-10T03:00:00Z',products:products.map((p,i)=>i===11?{...p,rawText:p.title+' $5.99 已售出：999 关键词：Late seller phrase',salesFields:[{label:'已售出',value:'999'}],productKeywords:[{productId:p.id,query:'Late seller phrase',evidence:'关键词：Late seller phrase',pageUrl:providerFixture.pageUrl}]}:p)};
  document.getElementById('read-provider').click();await settle();
  const leader=document.querySelector('#keywords .seller-entry');assert.equal(leader.dataset.productId,products[11].id);assert.match(leader.textContent,/Late seller phrase/);assert.match(leader.textContent,/999/);assert.equal(comparisonRequests,beforeRequests);
  const updatedCard=document.querySelector(`#exact-results [data-product-id="${products[11].id}"]`);assert.match(updatedCard.querySelector('.keyword-preview').textContent,/Late seller phrase/);assert.match(updatedCard.querySelector('.product-meta').textContent,/999/);
  const leaderSaved=lastSaved.items.find(item=>item.id===products[11].id);assert.equal(leaderSaved.productKeywords.length,1);
  providerFixture={...providerFixture,capturedAt:'2026-10-10T04:00:00Z'};document.getElementById('read-provider').click();await settle();assert.equal(comparisonRequests,beforeRequests);assert.equal(leaderSaved.productKeywords.length,1);
  let exportedBlob;const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  URL.createObjectURL=blob=>{exportedBlob=blob;return 'blob:fixture';};URL.revokeObjectURL=()=>{};
  try{document.getElementById('export').click();const data=JSON.parse(await exportedBlob.text());assert.equal(data.version,'0.3.7');assert.equal(data.keywordTopCount,10);assert.equal(data.keywords[0].products.length,10);assert.equal(data.products.length,13);assert.equal(data.keywords[0].products[0].keywordEvidence[0].query,'Late seller phrase');assert.equal(data.products.find(p=>p.id===products[11].id).keywordEvidence[0].capturedAt,'2026-10-10T03:00:00Z');assert.equal(data.imageSearchInput.imageUrl,imageUrl);assert.equal(data.imageSearchInput.title,'Top10 fixture reference');}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
  providerFixture={...providerFixture,products:providerFixture.products.map(p=>({...p,productKeywords:[]}))};document.getElementById('read-provider').click();await settle();assert.equal(comparisonRequests,beforeRequests);assert.doesNotMatch(document.querySelector('#keywords .seller-entry').textContent,/Late seller phrase/);
  providerFixture={...providerFixture,products:providerFixture.products.map((p,i)=>i===0?{...p,imageUrl:'https://img.kwcdn.com/top10-changed-product.jpg',title:'Changed original product title'}:p)};document.getElementById('read-provider').click();await settle();assert.ok(comparisonRequests>beforeRequests,'changed product images and titles must still be reviewed');assert.equal(lastSaved.items.find(p=>p.id===products[0].id).title,'Changed original product title');
  assert.equal(createdTabs.length,beforeTabs);
});

test('continuous collection stops at 50 total candidates, preserves virtualized rows and refreshes prices without more navigation',async()=>{
  document.getElementById('cancel').click();await settle();
  const oldSend=chrome.runtime.sendMessage,oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval,oldNow=Date.now;
  const timers=new Map();let serial=0,clock=Date.now(),view=0,actions=[];
  globalThis.setInterval=callback=>{const id={fixtureTimer:++serial};timers.set(id,callback);return id;};
  globalThis.clearInterval=id=>{if(!timers.delete(id))oldClear(id);};Date.now=()=>clock;
  const imageUrl='https://img.kwcdn.com/continuous-reference.jpg';
  const makeProduct=i=>({...fixture.products[0],id:String(601123456780000+i),url:'https://www.temu.com/goods.html?goods_id='+String(601123456780000+i),title:'Captured continuous listing '+i,salesFields:[{label:'已售出',value:String(i)}]});
  const windows=[Array.from({length:30},(_,i)=>makeProduct(i)),Array.from({length:20},(_,i)=>makeProduct(i+25)),Array.from({length:30},(_,i)=>makeProduct(i+45))];
  const getPage=()=>({pageUrl:'https://www.temaishuju.com/plugin/search-image?url='+encodeURIComponent(imageUrl),capturedAt:new Date(clock).toISOString(),queryImageUrl:imageUrl,state:'results',products:windows[view],keywords:[],navigation:{supported:true,queryKey:'continuous-original',pageKey:view===2?'page-2':'page-1',position:view?1000:0,height:2000,atBottom:view>0,loading:false,nextKind:view===1?'next':'',nextKey:view===1?'next:2':'',endEvidence:view===2?'没有更多商品了':''}});
  chrome.runtime.sendMessage=async message=>{
    if(message.type==='collect-provider')return {ok:true,data:getPage()};
    if(message.type==='advance-results'){actions.push(message);const action=view===0?'scroll':'next';view++;return {ok:true,data:{action}};}
    return oldSend(message);
  };
  const tick=async()=>{clock+=2000;for(const callback of [...timers.values()])callback();await settle();};
  try{
    blockComparisons=true;referenceFixture={...fixture,detail:{id:'601123456789999',title:'Captured collection reference',detailsText:specText,images:[imageUrl]}};
    const beforeRequests=comparisonRequests,beforeTabs=createdTabs.length;
    storageListeners[0]({'temuSelection:1':{newValue:{id:'selection-collection',windowId:1,tabId:1,imageUrl,productId:'601123456789999'}}},'session');await settle();
    await tick();await tick();assert.equal(lastSaved.items.length,45);assert.equal(comparisonRequests,beforeRequests,'capture comes before slow image review');
    document.getElementById('stop-collection').click();await settle();assert.equal(lastSaved.collection.reason,'manual');
    document.getElementById('cancel').click();await settle();
    document.getElementById('resume-collection').click();await settle();
    clock+=180000;await tick();assert.equal(lastSaved.items.length,50);assert.equal(lastSaved.collection.status,'paused');
    await tick();await tick();assert.equal(lastSaved.collection.reason,'limit-reached');assert.equal(lastSaved.collection.total,50);assert.equal(lastSaved.collection.pageKeys.length,2);
    assert.equal(new Set(lastSaved.items.map(item=>item.id)).size,50);assert.ok(lastSaved.items.some(item=>item.id===windows[0][0].id),'earlier virtualized rows are retained');
    assert.equal(actions.length,2);assert.ok(actions.every(action=>action.queryKey==='continuous-original'));assert.equal(createdTabs.length,beforeTabs+1);assert.match(document.getElementById('collection-status').textContent,/全站覆盖未核实/);
    windows[2][0]={...windows[2][0],priceText:'$4.12'};await tick();assert.equal(lastSaved.items.find(item=>item.id===windows[2][0].id).priceText,'$4.12');assert.equal(actions.length,2,'passive price refresh never loads more results');assert.equal(lastSaved.collection.status,'paused');assert.equal(lastSaved.collection.reason,'limit-reached');
    document.getElementById('cancel').click();await settle();
    let blob;const oldCreate=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:collection';};
    try{document.getElementById('export').click();const data=JSON.parse(await blob.text());assert.equal(data.products.length,50);assert.equal(data.candidateLimit,50);assert.equal(data.siteWideComplete,false);assert.equal(data.collection.total,50);assert.equal(data.collections.length,1);}finally{URL.createObjectURL=oldCreate;}
  }finally{document.getElementById('cancel').click();await settle();blockComparisons=false;chrome.runtime.sendMessage=oldSend;globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;Date.now=oldNow;}
});

test('query diagnostics retain submitted inputs and observed scope/currency after the third-party tab closes',async()=>{
  const oldSend=chrome.runtime.sendMessage;
  try{
    document.getElementById('cancel').click();await settle();
    referenceFixture={...fixture,detail:undefined,products:[]};
    const imageUrl='https://img.kwcdn.com/diagnostic-cup.jpg';
    storageListeners[0]({'temuSelection:1':{newValue:{id:'diagnostic-cup',windowId:1,tabId:1,imageUrl,title:'Original tumbler title',titleSource:'product-title-element'}}},'session');await settle();
    providerFixture={state:'results',pageUrl:createdTabs.at(-1).url,queryImageUrl:imageUrl,queryTitle:'Original tumbler title',captureScope:'active-temu-result-list',capturedAt:fixture.capturedAt,products:[{...fixture.products[0],title:'Sticker book',priceText:'CA$3.77',market:'unverified'}],keywords:[]};
    document.getElementById('read-provider').click();await settle();
    assert.deepEqual(lastSaved.imageSearchDiagnostics.observations[0].currencies,['CAD']);
    assert.match(document.getElementById('provider-input-observed').textContent,/Temu普通结果列表.*CAD.*Original tumbler title/);
    document.getElementById('read-provider').click();await settle();assert.equal(lastSaved.imageSearchDiagnostics.observations.length,1);
    chrome.runtime.sendMessage=async message=>message.type==='collect-provider'?{ok:false,error:'图搜标签页已关闭'}:oldSend(message);
    document.getElementById('read-provider').click();await settle();assert.equal(lastSaved.providerJob,null);
    let blob;const original=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:diagnostics';};
    try{document.getElementById('export').click();const data=JSON.parse(await blob.text());assert.equal(data.imageSearchInput.title,'Original tumbler title');assert.equal(data.imageSearchDiagnostics.observations[0].captureScope,'active-temu-result-list');assert.deepEqual(data.imageSearchDiagnostics.observations[0].currencies,['CAD']);}finally{URL.createObjectURL=original;}
    storageListeners[0]({'temuSelection:1':{newValue:{id:'diagnostic-new-query',windowId:1,imageUrl,title:'Different reference'}}},'session');await settle();assert.equal(lastSaved.imageSearchDiagnostics.observations.length,0);
  }finally{chrome.runtime.sendMessage=oldSend;}
});

test.after(()=>window.dispatchEvent(new window.Event('pagehide')));
