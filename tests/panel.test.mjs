import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {localSpecChecks,decideProductMatch} from '../shared/core.mjs';
const {document,window}=parseHTML(await readFile(new URL('../extension/panel.html',import.meta.url),'utf8'));
globalThis.document=document;globalThis.window=window;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const saved={referenceImage:image,referenceSpecs:{},profile:{name:'Saved product',keywords:['legacy invented keyword']},keywords:['legacy invented keyword'],selectedQueries:['legacy invented keyword'],items:[],pages:[],lastRun:null};
const fixture={pageUrl:'https://www.temu.com/search_result.html?search_key=blue+bottle',capturedAt:'2026-10-08T05:00:00.000Z',challenge:false,products:[{id:'601123456789001',url:'https://www.temu.com/goods.html?goods_id=601123456789001',title:'Fixture blue bottle',imageUrl:'https://img.kwcdn.com/fixture.jpg',rawText:'Fixture blue bottle $5.99 10K+ sold',detailsText:'Fixture blue bottle',priceText:'$5.99',market:'us',capturedAt:'2026-10-08T05:00:00.000Z'}]};
const storageListeners=[],createdTabs=[];
let providerFixture=null;
let referenceFixture=null,comparisonRequests=0,lastSaved=null,batchSize=12,blockComparisons=false,blockedRequests=0;
let stagedFixture=false;
let fastMock=false;
let attentionMock=false;
let instanceMock=false;
let inferredMock=false;
const phases=[];
const specText='Brand: Acme; Model: A12; Material: silicone; Capacity: 500ml; Quantity: 1pc';
globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{onChanged:{addListener:fn=>storageListeners.push(fn)},session:{get:async()=>({temuMatch:saved}),set:async value=>{lastSaved=value['temuMatch:1'];}},local:{get:async()=>({preferences:{maxCandidates:batchSize}}),set:async()=>{}}},tabs:{create:async options=>{createdTabs.push(options);return{id:3};},query:async()=>[{id:1}],get:async()=>({status:'complete'}),remove:async()=>{},update:async()=>{}},runtime:{sendMessage:async message=>({ok:true,data:message.type==='collect-provider'?providerFixture:referenceFixture||fixture}),openOptionsPage:async()=>{}}};
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
    if(inferredMock&&body.phase==='subject-review'){comparison.subject=null;comparison.instanceMatch=null;comparison.fastMatch=null;comparison.listingColorMatch={matched:true,colorEvidence:{valid:true,similarity:.9},reason:'标题及配色推定，未核验主体细节'};}
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
  assert.equal(lastSaved.matchingPolicy,'title-first-v13');
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
  assert.match(card.textContent,/22pcs \(11Pairs\)/);assert.match(card.textContent,/材质 Latex/);assert.match(card.textContent,/Actual Brand/);assert.match(card.textContent,/G22/);assert.match(card.textContent,/标题原文/);assert.match(card.textContent,/品牌可辅助推定/);assert.match(card.textContent,/\$13.13/);
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

test('titles order requests first; unrelated categories avoid slow review; inferred cards retain price/title/link without supplying verified keywords',async()=>{
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
  assert.equal(requests.some(body=>body.phase==='subject-review'&&body.imageUrl===unrelated.imageUrl),false);
  const review=requests.find(body=>body.phase==='subject-review');assert.equal(review.candidateTitle,near.title);assert.equal(review.referenceTitle,title);
  const row=lastSaved.items.find(item=>item.id===near.id);assert.equal(row.status,'inferred-match');assert.equal(row.price.raw,'$13.13');assert.equal(row.title,near.title);assert.equal(row.url,near.url);
  assert.match(document.getElementById('exact-results').textContent,/标题 \/ 配色推定同款/);assert.match(document.getElementById('exact-results').textContent,/细节未核验/);
  assert.match(document.getElementById('count').textContent,/1 个推定/);assert.equal(document.getElementById('keywords').querySelectorAll('a').length,0);
  assert.equal(lastSaved.items.find(item=>item.id===unrelated.id).status,'pending');assert.equal(createdTabs.length,before);
  inferredMock=false;
});

test.after(()=>window.dispatchEvent(new window.Event('pagehide')));
