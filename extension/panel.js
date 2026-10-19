import {SPEC_KEYS,parseSales,rankMatches,isProductMatch,manualDecision,effectiveMatchStatus,keywordMetrics,bestSellerKeywords,listingKeywordEvidence,listingSpecs,titleQuantity} from './core.mjs';
import {titleMatchEvidence} from './title-match.mjs';
import {officialImage,providerSearchURL,providerListingTitle,normalizeProviderPage} from './provider.mjs';
import {priceObservation,priceKindLabel} from './prices.mjs';
import {listingMetadata,LISTING_LABELS} from './listing.mjs';
import {COLLECTION_LIMIT,limitedCandidates,createCollection,pauseCollection,resumeCollection,collectionDecision,recordCollectionAdvance,collectionText} from './collection.mjs';
import {referenceMemoryKey,candidateMemoryKey,memoryStorageKey,memoryRecord} from './manual-memory.mjs';
import {engineRequest,closeEngine,ENGINE_REVISION,onEngineConnection} from './local-engine-client.mjs';

const $=id=>document.getElementById(id);
const windowId=(await chrome.windows.getCurrent()).id;
const stateKey='temuMatch:'+windowId,selectionKey='temuSelection:'+windowId;
const MATCHING_POLICY='title-groups-outline-v16';
const emptyState=()=>({matchingPolicy:MATCHING_POLICY,engineRevision:ENGINE_REVISION,matchRevision:1,manualReferenceKey:'',referenceContext:null,keywordPolicy:'best-sellers-v1',referenceImage:'',referenceSpecs:{},profile:null,keywords:[],keywordSources:{},selectedQueries:[],items:[],pages:[],lastRun:null,selection:null,providerJob:null,imageSearchDiagnostics:null,collection:null,collectionHistory:[]});
let state=emptyState();
let busy=false,cancelled=false,healthTimer=null;
let providerTimer=null,providerReading=false,queuedSelection=null,selectionProcessing=false;
let autoPending=false,autoTimer=null,autoPaused=false,serviceAvailable=false;
let storageWarning='';
let activity=null,analysisError='';
let waitingForService=false;
const removeEngineConnection=onEngineConnection(connection=>{
  if(connection==='recovering'){waitingForService=true;serviceAvailable=false;document.body.dataset.service='recovering';$('service-status').textContent='后台连接中断 · 正在自动恢复';$('service-help').hidden=false;renderProgress();}
  else if(connection==='ready'){waitingForService=false;checkHealth();}
});
let resultTab='same',providerAutoOpen=false;
let resultsCollapsed=false,previewAnchor=null,previewPointer=null;
let manualRecord=null,manualWarning='',manualReadEpoch=0;
const pendingManual=new Map();
const requestControllers=new Set();
let saveQueue=Promise.resolve();
let referenceWarmup=null;
const tempTabs=new Set();

function status(message,error=false){if(storageWarning){if(!message.includes(storageWarning))message=storageWarning+(error?' '+message:'');error=true;}$('status').textContent=message;$('status').classList.toggle('error',error);$('status').hidden=!error&&!/^(已归为|已移到|已恢复自动|已复制|无法复制)/.test(message);}
function isDifferent(item){return ['different','manual-different'].includes(effectiveMatchStatus(item));}
function needsPageReview(item){return !manualDecision(item)&&['unreviewed','pending'].includes(item.status)&&item.autoAttempt!==state.matchRevision;}
function needsSubjectReview(item){return !manualDecision(item)&&item.status==='pending'&&item.autoAttempt===state.matchRevision&&!item.priorityError&&item.subjectAttempt!==state.matchRevision;}
function reviewComplete(item){return Boolean(manualDecision(item))||(!needsPageReview(item)&&!needsSubjectReview(item));}
function setActivity(stage,detail=''){activity={stage,detail};renderProgress();}
function renderProgress(){
  const section=$('analysis-progress'),total=state.items.length;
  section.hidden=(!state.referenceImage&&!total)||(!total&&!busy&&!state.providerJob&&!state.collection);if(section.hidden)return;
  const collecting=state.collection?.status==='running';
  const same=state.items.filter(isProductMatch).length,different=state.items.filter(isDifferent).length;
  const completed=state.items.filter(reviewComplete).length;
  const pending=state.items.filter(item=>!isProductMatch(item)&&!isDifferent(item)&&reviewComplete(item)).length;
  const waiting=total-completed,manual=state.items.filter(item=>manualDecision(item)).length;
  const paused=autoPaused&&waiting>0;
  const blocked=['challenge','login','unsupported','query-changed','tab-closed','page-error'].includes(state.collection?.reason);
  let stage=activity?.stage||(!total?'collect':waiting?(state.items.some(needsPageReview)?'images':'subject'):'complete');
  if(collecting||(!total&&!activity))stage='collect';
  const running=collecting||Boolean(activity)||(!paused&&!analysisError&&waiting>0&&serviceAvailable);
  let title=({collect:'正在收集商品',images:'正在筛选图片',subject:'正在核对商品主体',complete:'核对完成'})[stage];
  let detail=activity?.detail||'';
  if(collecting)detail='先收集候选，再自动核对；最多'+COLLECTION_LIMIT+'条，不足时按实际数量。';
  else if(waitingForService&&!cancelled){title='后台正在自动恢复';detail='当前结果已保留，连接恢复后会继续核对；未完成商品不会算作已完成。';}
  else if(analysisError){title='处理遇到问题';detail=analysisError;}
  else if(paused){title='核对已暂停';detail='已保留当前结果，点“继续核对”接着处理。';}
  else if(!total){title=blocked?'等待处理图搜页面':'等待商品结果';detail=$('provider-status').textContent;}
  else if(waiting&&!busy&&!autoPending&&!autoTimer&&!serviceAvailable){title='正在准备本机助手';detail='准备好后会自动核对，已读取商品保留。';}
  else if(!waiting&&!busy){title='核对完成';detail=pending?'还有 '+pending+' 条无法确认，可展开查看或重试。':'可以查看结果，也可以在卡片上调整分类。';}
  else if(!detail)detail=stage==='subject'?'正在比较主体细节，并按规则补充颜色与轮廓；单张图片可能需要较长时间。':'先核对已抓取的图片，再核对尚未确认的主体。';
  const max=collecting?COLLECTION_LIMIT:total,value=collecting?total:completed;
  const percent=max?Math.round(value/max*100):0;
  $('progress-title').textContent=title;$('progress-percent').textContent=max?percent+'%':'—';
  $('progress-fill').style.width=percent+'%';
  const count=collecting?'已收集 '+total+' / 最多 '+COLLECTION_LIMIT+' 条候选':!total?'还没有读取到商品，请按下方提示继续。':'已完成核对 '+completed+' / '+total+' 条'+(waiting?' · 剩余 '+waiting+' 条':'');
  $('progress-count').textContent=count;
  $('progress-bar').setAttribute('aria-label',collecting?'候选收集额度使用比例':'商品核对完成比例');
  $('progress-bar').setAttribute('aria-valuenow',String(percent));$('progress-bar').setAttribute('aria-valuetext',count);
  $('progress-detail').textContent=detail;
  $('progress-totals').replaceChildren(...['同款 '+same,'非同款 '+different,'无法确认 '+pending,...(manual?['人工调整 '+manual]:[])].map(text=>node('span','',text)));
  section.classList.toggle('is-active',running);section.dataset.phase=analysisError?'error':paused?'paused':stage;
  section.dataset.empty=String(!total&&!collecting);
  $('resume-analysis').hidden=busy||!total||(!paused&&!analysisError);
  $('resume-analysis').textContent=analysisError?'重试核对':'继续核对';
  const index=['collect','images','subject','complete'].indexOf(stage);
  for(const [i,step]of [...section.querySelectorAll('[data-step]')].entries()){
    step.classList.toggle('current',i===index);step.classList.toggle('done',i<index);
    if(i===index)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
  }
}
function getSpecs(){return Object.fromEntries(SPEC_KEYS.map(key=>[key,$('spec-'+key).value.trim()]));}
function setBusy(value){
  busy=value;
  ['analyze','collect','search-keywords','compare-collected','add-keyword','upload','replace-image','export','provider-search'].forEach(id=>$(id).disabled=value);
  $('analyze').disabled=value||!state.referenceImage;
  $('compare-collected').disabled=value||!state.referenceImage||!state.items.length;
  SPEC_KEYS.forEach(key=>{$('spec-'+key).disabled=value;});
  $('cancel').hidden=!value;
}
function checkCancelled(){if(cancelled)throw new Error('本次检索已停止');}
async function api(path,body,{signal}={}){
  checkCancelled();
  signal?.throwIfAborted();
  const controller=new AbortController();requestControllers.add(controller);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>controller.abort(),180_000);
  try{
    const result=await engineRequest(path,body,{signal:controller.signal});
    if(result.ok===false)throw new Error(result.error||'本机识别返回错误');
    return result;
  }catch(error){
    if(signal?.aborted)throw signal.reason;
    if(error.name==='AbortError')throw new Error(cancelled?'本次检索已停止':'本机识别超时，请稍后重试');
    if(error instanceof TypeError)throw new Error('本机识别初始化失败，请重新打开侧栏后重试');
    throw error;
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);requestControllers.delete(controller);}
}
function prefetchImages(items){
  const images=items.slice(0,3).map(item=>item.imageUrl).filter(url=>officialImage(url)||/^data:image\/(?:png|jpeg|webp);base64,/.test(url));
  if(images.length&&!cancelled)engineRequest('/prefetch',{images}).catch(()=>{});
}
function cancelReferenceWarmup(){referenceWarmup?.controller.abort();referenceWarmup=null;}
function warmReference(){
  const referenceImage=state.referenceImage,referenceTitle=state.referenceContext?.title||state.selection?.title||'';
  if(cancelled||!referenceImage)return;
  // Downloading this same selection changes URL -> data URL, not its identity.
  // Keep its in-flight preparation; new selections/uploads create a new state.
  if(referenceWarmup?.state===state&&!referenceWarmup.controller.signal.aborted)return;
  cancelReferenceWarmup();const controller=new AbortController(),row={state,image:referenceImage,title:referenceTitle,controller};
  referenceWarmup=row;requestControllers.add(controller);
  // Start preparation alongside normal page loading; it never classifies items,
  // changes progress, or blocks opening the search tab. Stop/replace aborts it.
  engineRequest('/prefetch',{referenceImage,referenceTitle},{signal:controller.signal}).catch(()=>{if(referenceWarmup===row)referenceWarmup=null;}).finally(()=>requestControllers.delete(controller));
}
async function save(){
  state.referenceSpecs=getSpecs();
  const current=state,key=stateKey,storage=chrome.storage.session,task=saveQueue.then(()=>storage.set({[key]:current}));saveQueue=task.catch(()=>{});
  try{await task;storageWarning='';}catch{storageWarning='浏览器会话存储空间不足：数据仍在当前侧栏内，请保持侧栏打开并导出 JSON。';}
  if(storageWarning){$('collection-section').hidden=false;$('collection-status').textContent=collectionText(state.collection)+' '+storageWarning;status(storageWarning,true);}
}
function applyManualMemory(){
  if(!manualRecord||manualRecord.referenceKey!==state.manualReferenceKey)return;
  for(const item of state.items){
    const key=candidateMemoryKey(item);if(pendingManual.get(state.manualReferenceKey+'|'+key)===state)continue;
    const entry=manualRecord.entries[key];
    if(entry&&entry.decision!=='automatic')item.manualClassification={...entry,persistent:true,referenceKey:state.manualReferenceKey};
    else if(entry||item.manualClassification?.persistent)delete item.manualClassification;
  }
}
function acceptManualRecord(raw,{reset=false}={}){
  const record=memoryRecord(raw,state.manualReferenceKey);
  if(!reset&&manualRecord?.referenceKey===record.referenceKey&&record.revision<manualRecord.revision)return;
  manualRecord=record;applyManualMemory();
}
async function loadManualMemory(){
  const current=state;manualRecord=null;manualWarning='';manualReadEpoch++;
  try{
    const referenceKey=await referenceMemoryKey(current);if(current!==state)return;
    state.manualReferenceKey=referenceKey;if(!referenceKey)return;
    const epoch=manualReadEpoch,key=memoryStorageKey(referenceKey),saved=await chrome.storage.local.get(key);
    if(current!==state)return;
    if(epoch===manualReadEpoch)acceptManualRecord(saved[key]);
    const legacy=state.items.filter(item=>manualDecision(item)&&!item.manualClassification.persistent&&candidateMemoryKey(item)&&!manualRecord?.entries[candidateMemoryKey(item)]).map(item=>({candidateKey:candidateMemoryKey(item),decision:manualDecision(item),updatedAt:item.manualClassification.updatedAt}));
    if(legacy.length){
      const response=await chrome.runtime.sendMessage({type:'manual-memory-update',referenceKey,entries:legacy,onlyMissing:true});
      if(!response?.ok||!response.record)throw new Error(response?.error||'旧人工分类无法迁移到长期存储');
      if(current===state)acceptManualRecord(response.record);
    }
  }catch(error){if(current===state)manualWarning='历史人工分类暂时无法读取或保存：'+error.message+'。本次调整仍可重试。';}
}
function addKeyword(query){
  query=String(query||'').trim().slice(0,180);
  if(!query||state.keywords.includes(query))return;
  state.keywords.push(query);if(state.selectedQueries.length<3)state.selectedQueries.push(query);
}
function renderKeywords(){
  $('keyword-section').hidden=!state.items.some(isProductMatch);
  const container=$('keywords');container.replaceChildren();
  const groups=bestSellerKeywords(state.items);
  $('keyword-caption').textContent='每组 Top10 · 页面显示销量';
  if(!groups.length)container.append(node('p','hint','工具自动判断同款并读取销量后，再收集畅销商品的关键词。'));
  for(const group of groups){
    const first=group.products[0],section=node('div','seller-keywords');
    section.append(node('p','hint',(first.salesSource==='provider-visible'?'特卖数据图搜':'TEMU 页面')+' · '+(first.market==='us'?'美国站':'国家站未核实')+' · '+periodText(first.sales)+' · 已确认且有销量 '+group.eligibleProducts+' 款，取前 '+group.products.length+' 款'));
    if(group.products.some(item=>!item.sales.exact))section.append(node('p','hint','包含约数 / 销量下限，按页面显示数字排列，无法确认精确销量名次。'));
    for(const product of group.products){
      const entry=node('article','seller-entry');entry.dataset.productId=product.id;
      const link=node('a','product-name','第 '+product.salesRank+' 款 · '+product.title);link.href=product.url;link.target='_blank';link.rel='noopener noreferrer';entry.append(link);
      entry.append(node('p','hint',(product.price?.raw||product.priceText||'价格未读取')+' · '+product.sales.raw+' · '+(manualDecision(product)==='same'?'人工归为同款':product.status==='outline-match'?'主体轮廓补充同款':product.status==='rule-match'?'主体颜色补充同款':'主体一致同款')));
      entry.append(keywordEvidenceBlock(product.keywordEvidence,true));section.append(entry);
    }
    container.append(section);
  }
  const retrieval=$('retrieval-keywords');retrieval.replaceChildren();
  const metrics=keywordMetrics(state.keywords,state.items);
  const byQuery=new Map(metrics.map(item=>[item.query,item]));
  for(const query of state.keywords){
    const button=document.createElement('button');button.type='button';button.className='keyword';button.setAttribute('aria-pressed',String(state.selectedQueries.includes(query)));
    button.append(document.createTextNode(query));
    const metric=byQuery.get(query);
    if(metric?.total){const small=document.createElement('small');small.textContent='已读取 '+metric.total+' · 已核对 '+metric.evaluated+' · 完全同款 '+metric.exactCount;button.append(small);}
    button.addEventListener('click',()=>{
      if(busy)return;
      if(state.selectedQueries.includes(query))state.selectedQueries=state.selectedQueries.filter(item=>item!==query);
      else if(state.selectedQueries.length<3)state.selectedQueries.push(query);
      else{status('一次最多检索 3 组关键词，请先取消一组');return;}
      renderKeywords();save();
    });retrieval.append(button);
  }
}
function keywordEvidenceBlock(words,retrieval=false){
  const block=node('div','link-keywords');
  if(!words.length)block.append(node('p','hint','此链接未展示商品关键词，标题也无可摘录原词。'));
  for(const word of words){
    const entry=node('div','keyword-source');entry.append(node('strong','',word.query));
    entry.append(node('p','hint',word.kind==='product-keyword'?'商品页面关键词':'商品标题原词'));
    const evidence=node('details');evidence.append(node('summary','','查看原文与采集来源'));
    evidence.append(node('p','product-note','原文证据：'+word.evidence));
    if(word.pageUrl){const link=node('a','','关键词采集页面 ↗');link.href=word.pageUrl;link.target='_blank';link.rel='noopener noreferrer';evidence.append(link);}
    const captured=new Date(word.capturedAt||'');evidence.append(node('p','product-note','采集时间：'+(Number.isNaN(captured.getTime())?'未记录':captured.toLocaleString('zh-CN'))));
    entry.append(evidence);
    if(retrieval){const use=node('button','quiet','用此词检索');use.type='button';use.disabled=busy;use.addEventListener('click',()=>{addKeyword(word.query);renderKeywords();save();});entry.append(use);}
    block.append(entry);
  }
  return block;
}
function productKeywordBlock(item){
  const block=node('section','product-keywords'),words=listingKeywordEvidence(item);
  block.setAttribute('aria-label','此商品的销量与关键词');
  block.append(node('strong','product-keyword-heading','销量与关键词'));
  const sales=node('div','product-meta');
  sales.append(node('span','',item.sales?.raw?'销量：'+item.sales.raw:'销量未展示'));
  if(item.sales?.raw)sales.append(node('span','',periodText(item.sales)));
  block.append(sales);
  if(words.length){
    block.append(node('p','keyword-origin',words[0].kind==='product-keyword'?'商品页面关键词':'商品标题原词'));
    const preview=node('div','keyword-preview');
    for(const word of words.slice(0,3)){
      const row=node('div','keyword-preview-row'),text=node('span','keyword-preview-text',word.query);
      text.title=word.query;
      const copy=node('button','quiet','复制');copy.type='button';copy.setAttribute('aria-label','复制关键词：'+word.query);
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(word.query);status('已复制关键词：'+word.query);}catch{status('无法复制，请展开完整原词后选中复制',true);}});
      row.append(text,copy);preview.append(row);
    }
    block.append(preview);
    const details=node('details','keyword-details');
    details.append(node('summary','','查看完整原词与来源 · '+words.length+' 条'),keywordEvidenceBlock(words));
    if(!item.sales||item.sales.kind==='unknown')details.append(node('p','hint','销量未知，仅展示此链接的原词来源，未进入销量 Top10。'));
    if(!isProductMatch(item)||effectiveMatchStatus(item)==='inferred-match')details.append(node('p','hint','仅展示此商品的页面原词，未作为同款关键词推荐。'));
    block.append(details);
  }else block.append(node('p','hint','此商品暂无可读取的页面关键词或标题原词。'));
  return block;
}
function safeImage(raw){if(typeof raw==='string'&&raw.length<500000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw))return raw;try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function periodText(sales){return sales?.periodLabel||({'30d':'近 30 天','7d':'近 7 天','1d':'日销量',total:'累计销量'})[sales?.period]||'销量统计周期未展示';}
function node(tag,cls,text){const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;}
const metricText=value=>Number.isFinite(value)?value.toFixed(3):'未读取';

function closeImagePreview(){previewAnchor=null;previewPointer=null;$('image-preview').hidden=true;$('image-preview-image').removeAttribute('src');}
function showImagePreview(image,pointer=null){
  const src=image.getAttribute('src');if(!src||image.closest('[hidden]'))return;
  previewAnchor=image;previewPointer=pointer;
  const preview=$('image-preview'),large=$('image-preview-image');
  large.src=src;large.alt=image.alt||'商品图片';large.referrerPolicy='no-referrer';
  $('image-preview-caption').textContent=image.alt||'商品图片';
  const width=document.documentElement.clientWidth||window.innerWidth||390,height=document.documentElement.clientHeight||window.innerHeight||840;
  const size=Math.min(480,width-24),imageSize=Math.max(1,Math.min(size-22,height-86));
  preview.style.width=size+'px';large.style.height=imageSize+'px';preview.hidden=false;
  const rect=image.getBoundingClientRect(),boxHeight=preview.getBoundingClientRect().height||imageSize+62;
  const beside=rect.right+10+size<=width-12;
  const left=beside?rect.right+10:(width-size)/2;
  const top=beside?rect.top:rect.top>=boxHeight+22?rect.top-boxHeight-10:rect.bottom+boxHeight+22<=height?rect.bottom+10:(height-boxHeight)/2;
  preview.style.left=Math.round(Math.max(12,Math.min(left,width-size-12)))+'px';
  preview.style.top=Math.round(Math.max(12,Math.min(top,height-boxHeight-12)))+'px';
}
function scrollImagePreview(){
  if(previewAnchor&&!previewPointer&&document.activeElement===previewAnchor){
    const rect=previewAnchor.getBoundingClientRect(),height=document.documentElement.clientHeight||window.innerHeight||840;
    if(rect.bottom>0&&rect.top<height){showImagePreview(previewAnchor);return;}
  }
  closeImagePreview();
}
function renderResultsVisibility(){
  $('results-body').hidden=resultsCollapsed;
  $('toggle-results').textContent=resultsCollapsed?'展开列表':'收起列表';
  $('toggle-results').setAttribute('aria-expanded',String(!resultsCollapsed));
  $('results-collapsed-note').hidden=!resultsCollapsed;
  $('results-collapsed-note').textContent='已收起 '+state.items.length+' 条商品，点击“展开列表”可继续查看。';
  // Keep a stationary hover while price/progress updates rebuild the same card.
  // A moved, hidden or replaced product must never retain another image's preview.
  if(previewAnchor&&!previewAnchor.isConnected&&previewPointer){
    const key=previewAnchor.dataset.previewKey,src=$('image-preview-image').getAttribute('src');
    const next=[...document.querySelectorAll('img.previewable-image')].find(image=>image.dataset.previewKey===key&&image.getAttribute('src')===src&&!image.closest('[hidden]'));
    if(next){const rect=next.getBoundingClientRect();if(previewPointer.x>=rect.left&&previewPointer.x<=rect.right&&previewPointer.y>=rect.top&&previewPointer.y<=rect.bottom)showImagePreview(next,previewPointer);}
  }
  if(previewAnchor&&(!previewAnchor.isConnected||previewAnchor.closest('[hidden]')||previewAnchor.getAttribute('src')!==$('image-preview-image').getAttribute('src')))closeImagePreview();
}

const PENDING_PREVIEW=5,PENDING_REVIEW_FLOOR=.85;
let pendingExpanded=false;
// Display-only ranking for the unconfirmed bucket: candidates without any positive
// image evidence are counted but not rendered, so the list stays human-reviewable.
function pendingScore(item){
  if(item.priorityError)return 2;
  if(item.autoAttempt!==state.matchRevision)return 1.5;
  if(item.subject?.valid)return item.subject.subjectSimilarity;
  if(item.fastMatch?.inliers>=20)return .9+Math.min(.09,item.fastMatch.inliers/2000);
  return 0;
}

function card(item,lead=false){
  const article=node('article','product'+(lead?' lead':''));
  const more=node('details','product-more');more.append(node('summary','','商品详情'));
  article.dataset.productId=item.id;article.dataset.source=item.salesSource||'temu-visible';
  const manual=manualDecision(item);
  if(lead){
    const caption=item.sales?.kind==='unknown'?'完全同款 · 页面未提供销量':item.sales?.kind==='approximate'?'页面显示销量数字最高 · 约数，精确名次未确认':item.sales?.kind==='lower-bound'?'页面显示销量数字最高 · 销量下限，精确名次未确认':item.sales?.period==='unknown'?'页面显示销量数字最高 · 统计周期未知':'同一销量口径内 · 页面显示销量数字最高';
    article.append(node('div','lead-title',caption));
  }
  const top=node('div','product-top');const image=node('img','previewable-image');image.alt=item.title;image.src=safeImage(item.matchedImageUrl||item.imageUrl);image.loading='lazy';image.referrerPolicy='no-referrer';image.tabIndex=0;image.dataset.previewKey=(item.salesSource||'temu-visible')+':'+item.id;image.setAttribute('aria-describedby','image-preview');top.append(image);
  const info=node('div');info.append(node('div','product-name',item.title));
  const price=item.price||priceObservation(item.priceText,{market:item.market});
  info.append(node('div','product-price',price.raw||'价格未读取'));
  more.append(node('p','product-note',priceKindLabel(price)+(price.currency?' · '+price.currency:' · 币种未确认')));
  more.append(node('p','full-title','原标题：'+item.title),node('p','hint','页面价格尚未绑定具体 SKU / 优惠条件，结算时请核实。'));
  const badge=item.status==='outline-match'?'同款 · 主体轮廓相似 · 轮廓补充':item.status==='rule-match'?'同款 · 标题相似 / 主体颜色相近':item.status==='inferred-match'?'旧版推定结果 · 等待重新核对':item.status==='exact'?'同款 · 图片主体一致 · 自动确认':item.status==='visual-match'?(item.matchStage==='page-image'?'同款 · 同图匹配 · 自动确认':item.instanceMatch?.matched?'同款本体 · 图中完整实例已核验':item.fastMatch?.matched?'同款 · 主体一致 · 快速图像核验':'同款 · 主体一致 · 自动核对'):item.status==='different'?'已排除 · '+(item.reason||'图片主体存在差异'):item.autoAttempt===state.matchRevision?'无法自动确认 · 不参与推荐':'等待工具自动核对';
  const shortBadge=manual?(manual==='same'?'人工归为同款':'人工标为非同款'):item.status==='outline-match'?'轮廓补充同款':item.status==='rule-match'?'颜色补充同款':isProductMatch(item)?'图片主体一致':isDifferent(item)?'非同款':'未确定';
  info.append(node('span','badge'+(manual?' manual-badge':''),shortBadge),productKeywordBlock(item));top.append(info);article.append(top);
  if(manual)article.append(node('p','manual-note',item.manualClassification.persistent?'已记住你的分类，下次自动沿用。':'正在保存分类；缺少可靠标识时仅保留本次。'));
  more.append(node('p','product-note',(item.salesSource==='provider-visible'?'来源：特卖数据图搜':'来源：TEMU 页面')+' · '+(item.market==='us'?'美国站':'国家站尚未核实')+' · '+periodText(item.sales)+' · 采集 '+new Date(item.capturedAt).toLocaleString('zh-CN')));
  if(price.sourceUrl)more.append(node('p','product-note','价格来源：'+(price.source==='provider-visible'?'特卖数据页面':'TEMU 商品页')+' · '+new Date(price.capturedAt).toLocaleString('zh-CN')));
  const autoNotes=node('div');
  if(item.status==='visual-match')autoNotes.append(node('p','hint',item.variantAmbiguous||state.referenceContext?.variantAmbiguous?'图片主体匹配；商品含多个 SKU，尺寸 / 套装与对应价格未绑定。':'图片主体匹配；未展示的品牌 / 尺寸 / 材质 / 数量单独保留未知。'));
  if(item.status==='rule-match')autoNotes.append(node('p','hint','主体细节未匹配；已完成主体核对，按“标题相似且主体颜色相近”的补充规则归为同款。价格、标题和链接保留页面原文。'));
  if(item.status==='outline-match'){
    const outline=item.outlineMatch;
    autoNotes.append(node('p','hint','主体细节尚未确认，按用户“主体轮廓相似”补充规则归为同款。轮廓指标不是同款概率；原图、原标题和价格保留。'));
    if(outline)autoNotes.append(node('p','product-note','轮廓交并比 '+Math.round(outline.iou*100)+'% · 边界覆盖 '+Math.round(outline.boundaryCoverage*100)+'%（两项门槛均为90%） · '+(outline.orientation?.mirror?'镜像后':'')+'旋转 '+(outline.orientation?.rotation||0)+'°'));
  }
  if(!manual)more.append(autoNotes);
  if(item.packDifference)more.append(node('p','hint','售卖数量不同：参考 '+item.packDifference.reference+'，此链接 '+item.packDifference.candidate+'。保留该链接的原页面价格，具体 SKU 未绑定，未折算单件价。'));
  if(item.salesSource==='provider-visible'&&item.sales?.kind==='unknown')more.append(node('p','hint','该商品未展示所选销量周期，不使用其他周期补齐。'));
  const listing=listingMetadata({title:item.title,text:item.detailsText||item.rawText||'',structuredSpecs:item.structuredSpecs,listingFields:item.listingFields,sourceUrl:item.sourceUrl,capturedAt:item.capturedAt});
  item.listingInfo=listing;
  const known=Object.entries(listing.fields).filter(([,field])=>field.value);
  if(known.length)more.append(node('p','hint','页面已列出：'+known.map(([key,field])=>LISTING_LABELS[key]+' '+field.value).join(' · ')));
  const listingDetails=node('details','listing-info');listingDetails.append(node('summary','','页面品牌与规格 · 已读取 '+known.length+' 项（规格仅作附注；品牌不单独决定同款）'));
  for(const [key,field]of Object.entries(listing.fields)){
    listingDetails.append(node('p','hint',LISTING_LABELS[key]+'：'+(field.value||'当前页面未展示')+(field.status==='options'?'（多个描述 / 选项，具体 SKU 未绑定）':'')+(field.source==='title-literal'?'（标题原文，具体 SKU 未核实）':'')));
    for(const evidence of field.evidence)listingDetails.append(node('p','product-note','来源：'+({'title-literal':'商品标题','visible-field':'当前商品字段','listing-text':'当前商品页面原文','structured-product':'当前商品结构化字段','public-jsonld':'当前商品公开结构化声明','public-microdata':'当前商品公开字段声明'}[evidence.source]||evidence.source)+' · '+evidence.evidence));
  }
  listingDetails.append(node('p','hint','店铺名不当作品牌，商品 ID 不当作型号；图片颜色和摆放数量不替代页面规格。'));
  more.append(listingDetails);
  const details=node('details');details.append(node('summary','',item.status==='different'?'查看差异':'查看核对依据'));
  details.append(node('p','hint','自动判断：'+badge));
  if(manual)details.append(node('p','hint','保留的自动判断：'+badge+'。人工调整时间：'+new Date(item.manualClassification.updatedAt).toLocaleString('zh-CN')),autoNotes);
  if(item.titleEvidence)details.append(node('p','hint',item.titleEvidence.reason+' · 标题规则分数 '+item.titleEvidence.score.toFixed(3)+'（不是同款概率）'));
  if(item.listingColorMatch?.colorEvidence?.valid)details.append(node('p','hint','主体关注区域颜色 '+item.listingColorMatch.colorEvidence.similarity.toFixed(3)+' · '+item.listingColorMatch.reason+'（特征指标，不是同款概率）'));
  if(item.subjectDifferences?.length)details.append(node('p','hint','主体核对记录：'+item.subjectDifferences.join('；')+'。本条依据标题相似组的颜色补充规则通过。'));
  const evidence=node('ul','evidence-list');
  const listingNotes=(item.missing||[]).filter(value=>/品牌|型号|材质|尺寸|容量|数量|套装|SKU|规格/.test(value)&&!/核对失败|图片|主体|图像/.test(value));
  const imageMissing=(item.missing||[]).filter(value=>!listingNotes.includes(value));
  for(const note of listingNotes.filter(note=>/不参与同款判断|SKU/.test(note)))listingDetails.append(node('p','product-note','页面信息附注：'+note+'（不作为图像未确认或排除依据）'));
  const lines=[...(item.evidence||[]),...(item.differences||[]),...imageMissing.map(value=>'无法确认：'+value)];
  if(!lines.length)lines.push('等待图片与规格核对');
  for(const text of lines.slice(0,16))evidence.append(node('li','',text));
  details.append(evidence);
  if(item.subject?.valid){
    details.append(node('p','hint',(item.subject.attention?.applied?'商品区域加权特征':'主体特征')+'余弦值 '+metricText(item.subject.subjectSimilarity)+' · 局部特征 '+metricText(item.subject.localSimilarity)+' · 颜色分布 '+metricText(item.subject.colorSimilarity)+'（特征分数，不是同款概率）'));
    const previews=node('div','subject-previews');for(const [label,src]of [['参考前景（原图保留）',item.subject.referencePreview],['候选前景（原图保留）',item.subject.candidatePreview]])if(src?.startsWith('data:image/png;base64,')){const img=node('img');img.alt=label;img.src=src;previews.append(img);}details.append(previews);
  }
  if(item.subject?.attention)details.append(node('p','hint',item.subject.attention.applied?'已降低明确人体区域的比对权重；图片中的手仍保留，商品细节不足时继续显示无法确认。':item.subject.attention.reason));
  if(item.subject?.layoutHint)details.append(node('p','hint',item.subject.layoutHint));
  for(const failure of item.subject?.failedChecks||[])details.append(node('p','hint',failure.label+'：'+(typeof failure.actual==='number'?failure.actual.toFixed(3):String(failure.actual))+'；核验要求 '+failure.required+'（特征指标，不是同款概率）'));
  if(item.rawText)details.append(node('p','hint','页面原文：'+item.rawText.slice(0,1600)));
  more.append(details);
  const actions=node('div','product-actions');
  const link=node('a','','查看商品 ↗');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
  const copy=node('button','','复制完整标题');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(item.title);status('已复制商品原始标题');}catch{status('无法复制，请直接选中标题复制',true);}});more.append(copy);
  const classify=node('button','classify-action',isProductMatch(item)?'移出同款':'归为同款');classify.type='button';classify.dataset.action=isProductMatch(item)?'different':'same';
  classify.addEventListener('click',()=>adjustClassification(item,isProductMatch(item)?'different':'same'));actions.append(classify);
  if(!isProductMatch(item)&&!isDifferent(item)){
    const exclude=node('button','','标为非同款');exclude.type='button';exclude.dataset.action='different';exclude.addEventListener('click',()=>adjustClassification(item,'different'));actions.append(exclude);
  }
  if(manual){const restore=node('button','quiet','恢复自动判断');restore.type='button';restore.dataset.action='restore';restore.addEventListener('click',()=>adjustClassification(item,null));actions.append(restore);}
  if(pendingManual.get(state.manualReferenceKey+'|'+candidateMemoryKey(item))===state)for(const button of actions.querySelectorAll('[data-action]'))button.disabled=true;
  article.append(actions,more);return article;
}

async function adjustClassification(displayItem,decision){
  // Ranked cards are copies. Resolve back to the captured source + product ID.
  const item=state.items.find(value=>value.id===displayItem.id&&(value.salesSource||'temu-visible')===(displayItem.salesSource||'temu-visible'));
  if(!item)return;const current=state,key=candidateMemoryKey(item),referenceKey=state.manualReferenceKey,pair=referenceKey+'|'+key;
  if(pendingManual.get(pair)===current)return;
  const finish=()=>{if(pendingManual.get(pair)===current)pendingManual.delete(pair);};
  const previous=item.manualClassification;pendingManual.set(pair,current);
  if(decision)item.manualClassification={decision,source:'user',updatedAt:new Date().toISOString()};else delete item.manualClassification;
  render();
  try{
    if(referenceKey&&key){
      const response=await chrome.runtime.sendMessage({type:'manual-memory-update',referenceKey,entries:[{candidateKey:key,decision:decision||'automatic'}]});
      if(!response?.ok||!response.record)throw new Error(response?.error||'浏览器未能保存分类');
      if(current!==state)return;
      finish();acceptManualRecord(response.record);manualWarning='';
    }else manualWarning='此条目缺少可靠的参考图或商品ID，只在本次分析保留，尚未写入长期记忆。';
  }catch(error){
    if(current!==state)return;
    if(previous)item.manualClassification=previous;else delete item.manualClassification;
    manualWarning='人工调整未保存，已恢复原分类：'+error.message+'。请稍后重试。';
    finish();render();await save();status(manualWarning,true);return;
  }finally{finish();}
  if(current!==state)return;
  render();await save();
  if(current!==state)return;
  status((decision==='same'?'已归为同款':decision==='different'?'已移到非同款分类':'已恢复自动判断')+'，同款数量、销量 Top10 与关键词已更新。'+(manualWarning||((referenceKey&&key)?decision?'已长期记住，下次查询同一参考商品会沿用。':'已取消这条分类记忆。':'已保存到本次分析。'))+(storageWarning?' '+storageWarning:''),Boolean(storageWarning||manualWarning));
  if(!decision)requestAutoCompare();
}

function priceGroups(items,direction){
  const groups=new Map(),other=[];
  for(const item of items){
    const price=item.price||priceObservation(item.priceText,{market:item.market});
    if(!['displayed','range','starting'].includes(price.kind)||!Number.isFinite(price.low)||price.low<0){other.push(item);continue;}
    // Unknown "$" amounts may be ordered as printed, without declaring USD or
    // merging them with a confirmed currency. No exchange-rate conversion.
    const symbol=price.raw?.match(/(?:US|CA|AU|A)?\$|[€£¥￥]/i)?.[0]||'';
    const key=price.currency?'currency:'+price.currency:'symbol:'+symbol;
    if(!groups.has(key))groups.set(key,{label:price.currency|| (symbol?symbol+'（原页面符号）':'原页面未标币种'),rows:[]});
    groups.get(key).rows.push({item,amount:price.low});
  }
  const result=[...groups.values()].map(group=>({label:group.label,items:group.rows.sort((a,b)=>direction*(a.amount-b.amount)).map(row=>row.item)}));
  if(other.length)result.push({label:'其他价格（未排序）',items:other});
  return result;
}
function render(){
  applyManualMemory();
  $('manual-memory-status').textContent=manualWarning||'人工分类长期保存在当前浏览器，关闭浏览器或重启电脑后仍保留；再次查询同一参考商品时沿用。';
  $('reference').hidden=!state.referenceImage;
  $('welcome').hidden=Boolean(state.referenceImage);
  const restart=Boolean(state.referenceImage)&&(['query-changed','tab-closed','page-error'].includes(state.collection?.reason)||/图搜标签页已关闭/.test(analysisError));
  $('analyze').hidden=!state.referenceImage||(!restart&&(Boolean(state.providerJob)||state.items.length>0));
  $('analyze').textContent=restart?'重新查找同款':'开始查同款';
  document.querySelector('.upload-label').hidden=Boolean(state.referenceImage);
  if(state.referenceImage)$('reference-image').src=state.referenceImage;
  $('reference-name').textContent=state.profile?.name||'待识别产品';
  $('reference-description').textContent=state.referenceContext?.message||state.profile?.description||'工具会自动比对图片；网页商品还会自动读取原商品信息。';
  renderKeywords();
  $('collection-section').hidden=!state.collection&&!storageWarning;
  $('collection-status').textContent=collectionText(state.collection)+(storageWarning?' '+storageWarning:'');
  $('stop-collection').hidden=state.collection?.status!=='running';
  $('resume-collection').hidden=!state.collection||state.collection.status==='running'||state.items.length>=COLLECTION_LIMIT;
  $('show-provider').hidden=!Number.isInteger(state.providerJob?.tabId);
  const needsProvider=state.providerJob&&(state.providerJob.manualUpload||['challenge','login','unsupported','query-changed','page-error'].includes(state.collection?.reason));
  $('provider-section').hidden=!state.providerJob;
  if(needsProvider){if(!$('provider-section').open)providerAutoOpen=true;$('provider-section').open=true;}
  else if(providerAutoOpen){$('provider-section').open=false;providerAutoOpen=false;}
  $('provider-label').textContent=needsProvider?(state.providerJob.manualUpload?'下一步：上传查询图片':'需要你处理图搜页面'):'图搜与同步';
  $('show-provider').classList.toggle('primary',Boolean(needsProvider));
  $('show-provider').textContent=state.providerJob?.manualUpload?'去图搜页上传图片':'查看图搜页';
  $('read-provider').textContent=busy?'更新已读商品价格':state.providerJob?.manualUpload?'已上传，继续查找':'继续读取结果';
  const input=state.providerJob?.submittedInput||state.imageSearchDiagnostics?.submittedInput;
  $('provider-input').hidden=!input;
  if(input){
    $('provider-input-image').src=safeImage(input.imageUrl||state.referenceImage);
    $('provider-input-title').textContent='提交原标题：'+(input.title||'未读取；第三方可能使用图片检索结果推导标题，候选可能不相关');
    $('provider-input-id').textContent='所选商品 ID：'+(input.productId||'未读取')+' · 标题来源：'+({'public-jsonld':'商品公开结构化标题','public-microdata':'商品公开字段标题','product-title-element':'商品标题元素','current-product-heading':'当前商品标题','current-document-title':'当前页面标题','enclosing-product-link':'所属商品链接','image-alt':'图片说明','captured-product':'已打开页面的同 ID 商品信息'}[input.titleSource]||'未记录');
    $('provider-input-link').href=input.imageUrl||'';$('provider-input-link').hidden=!input.imageUrl;
    const observed=state.imageSearchDiagnostics?.observations?.at(-1);
    $('provider-input-observed').textContent=observed?'最近读取：'+observed.capturedAt+' · '+(observed.captureScope==='active-temu-result-list'?'Temu普通结果列表':'可见商品卡片')+' · 页面币种：'+(observed.currencies.join(' / ')||'未识别')+'。网址标题：'+(observed.queryTitle||'未提供')+'（不代表第三方内部实际检索词）。':'';
  }
  $('results-section').hidden=!state.items.length;
  const exact=rankMatches(state.items),pending=state.items.filter(item=>!isProductMatch(item)&&!isDifferent(item)),different=state.items.filter(isDifferent);
  const colorRuleCount=exact.filter(item=>item.status==='rule-match').length;
  const outlineCount=exact.filter(item=>item.status==='outline-match').length;
  const manualCount=exact.filter(item=>manualDecision(item)==='same').length;
  $('count').textContent=exact.length+' 个同款匹配'+(manualCount?'（'+manualCount+' 个人工归类）':'')+(colorRuleCount?'（'+colorRuleCount+' 个主体颜色补充）':'')+(outlineCount?'（'+outlineCount+' 个主体轮廓补充）':'');
  $('scope').textContent='已读取 '+state.items.length+' 个商品 · 本次最多 '+COLLECTION_LIMIT+' 条 · '+state.pages.length+' 个页面 · 全站总量未知；国家站、数据来源和销量周期分别处理。';
  const order=$('result-sort').value||'match';
  if(order==='price'||order==='price-desc'){
    const groups=priceGroups(exact,order==='price' ? 1 : -1);
    $('exact-results').replaceChildren(...groups.flatMap(group=>[...(groups.length>1?[node('h3','price-group',group.label)]:[]),...group.items.map(item=>card(item,false))]));
  }else{
    const ordered=[...exact].sort((a,b)=>order==='sales'?0:Number(Boolean(b.samePhoto))-Number(Boolean(a.samePhoto))||Number(b.status==='exact')-Number(a.status==='exact')||(b.imageSimilarity||0)-(a.imageSimilarity||0));
    $('exact-results').replaceChildren(...ordered.map(item=>card(item,false)));
  }
  const rankedPending=[...pending].sort((a,b)=>pendingScore(b)-pendingScore(a));
  if(!pending.length)pendingExpanded=false;
  const shownPending=pendingExpanded?rankedPending:rankedPending.filter(item=>pendingScore(item)>=PENDING_REVIEW_FLOOR).slice(0,PENDING_PREVIEW);
  $('pending-results').replaceChildren(...shownPending.map(item=>card(item)));
  const hiddenPending=rankedPending.length-shownPending.length;
  if(hiddenPending||pendingExpanded){
    const note=node('p','hint',hiddenPending?'其余 '+hiddenPending+' 个无法自动确认的候选未列出（图像证据不足或差别较大）；导出 JSON 仍包含全部。':'已显示全部 '+pending.length+' 个无法自动确认的候选。');
    const toggle=node('button','',pendingExpanded?'收起':'展开全部');toggle.type='button';toggle.id='pending-toggle';toggle.addEventListener('click',()=>{pendingExpanded=!pendingExpanded;render();});
    note.append(' ',toggle);$('pending-results').append(note);
  }
  $('excluded-results').replaceChildren(...different.map(item=>card(item)));
  $('pending-count').textContent='自动处理 / 无法确认（显示 '+shownPending.length+' / 共 '+pending.length+'）';
  $('excluded-count').textContent='非同款商品（'+different.length+'）';
  $('same-total').textContent=exact.length;$('pending-total').textContent=pending.length;$('different-total').textContent=different.length;
  $('result-total').textContent='已读取 '+state.items.length+' 条';
  document.querySelector('.result-toolbar').hidden=!exact.length;
  $('matches-section').hidden=resultTab!=='same';$('pending-section').hidden=resultTab!=='pending';$('excluded-section').hidden=resultTab!=='different';
  $('pending-section').open=resultTab==='pending';$('excluded-section').open=resultTab==='different';$('excluded-empty').hidden=different.length>0;
  $('result-help').textContent=manualWarning||storageWarning||'判断有误？可在卡片上调整分类，下次会记住。';
  $('pending-section').querySelector('.bucket-help').textContent=pending.length?'这里是尚未确认的候选，可能含无关商品，不代表同款。图片核对会自动进行，也可自行调整分类。':'暂时没有未确定的商品。';
  for(const button of document.querySelectorAll('[data-result-tab]')){const selected=button.dataset.resultTab===resultTab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
  $('empty').hidden=exact.length>0;
  setBusy(busy);
  renderProgress();
  renderResultsVisibility();
}

async function ensureReferenceImage(){
  if(!state.referenceImage)throw new Error('请先上传图片或点击商品图片上的“查同款”');
  if(state.referenceImage.startsWith('data:'))return;
  const result=await api('/image',{imageUrl:state.referenceImage});state.referenceImage=result.dataUrl;render();
}
async function ensureReferenceContext(){
  const current=state,selection=state.selection;
  const selectedQuantity=titleQuantity(selection?.title);
  if(selectedQuantity&&!$('spec-quantity').value)$('spec-quantity').value=selectedQuantity;
  if(state.referenceContext?.collectionRevision==='declared-product-v1')return;
  if(!selection?.productId){state.referenceContext={collectionRevision:'declared-product-v1',message:'本地图片不包含商品详情；不可见规格会保留为未知。'};return;}
  status('正在自动读取原商品信息…');
  try{
    let page;
    try{if(selection.tabId)page=await collectTab(selection.tabId,selection.imageUrl);}catch(error){if(cancelled)throw error;}
    checkCancelled();if(current!==state)return;
    const detail=page?.detail?.id===selection.productId?page.detail:page?.products?.find(item=>item.id===selection.productId);
    if(!detail)throw new Error('已打开页面未提供所选商品信息，使用抓取图片核对，不另开详情页');
    const parsed=listingSpecs(detail.detailsText||detail.rawText,detail.structuredSpecs);
    const annotations=listingMetadata({title:detail.title,text:detail.detailsText||detail.rawText,structuredSpecs:detail.structuredSpecs,listingFields:detail.listingFields});
    for(const key of SPEC_KEYS){const field=annotations.fields[key];if(!parsed.specs[key]&&!parsed.conflicts.includes(key)&&field.status==='listed'&&field.source!=='title-literal'){parsed.specs[key]=field.value;parsed.evidence.push({key,value:field.value,evidence:field.evidence[0]?.evidence||field.value,source:field.source});}}
    const quantity=titleQuantity(detail.title);
    if(quantity&&!parsed.specs.quantity&&!parsed.conflicts.includes('quantity')){parsed.specs.quantity=quantity;parsed.evidence.push({key:'quantity',value:quantity,evidence:detail.title,source:'title'});}
    state.referenceContext={collectionRevision:'declared-product-v1',productId:detail.id,title:detail.title,text:detail.detailsText||detail.rawText,evidence:parsed.evidence,listingFields:detail.listingFields||[],referenceImages:['public-jsonld','bound-current-product-gallery'].includes(detail.declaredImageSource)?(detail.verifiedImages||[]).filter(officialImage).slice(0,6):[],imageSource:detail.declaredImageSource||'',variantAmbiguous:detail.variantAmbiguous,sourceUrl:detail.sourceUrl,capturedAt:detail.capturedAt,message:'已自动读取原商品信息；未展示的规格保留未知'+(detail.variantAmbiguous?'，原商品包含多个规格，无法确定图片对应的 SKU':'')+'。'};
    for(const key of SPEC_KEYS)if(!$('spec-'+key).value&&parsed.specs[key])$('spec-'+key).value=parsed.specs[key];
    state.referenceSpecs=getSpecs();
  }catch(error){if(cancelled)throw error;if(current===state)state.referenceContext={collectionRevision:'declared-product-v1',message:'原商品信息无法自动读取：'+error.message};}
  render();await save();
}
function requestAutoCompare(){
  if(autoPaused||!state.referenceImage||!state.items.some(item=>needsPageReview(item)||needsSubjectReview(item)))return;
  autoPending=true;drainAutoCompare();
}
function drainAutoCompare(){
  if((waitingForService&&!serviceAvailable)||!autoPending||autoPaused||busy||providerReading||selectionProcessing||queuedSelection||autoTimer||state.collection?.status==='running')return;
  autoTimer=setTimeout(()=>{
    autoTimer=null;if(busy||providerReading||selectionProcessing||queuedSelection||state.collection?.status==='running')return;
    if(!autoPending||autoPaused)return;
    autoPending=false;run(()=>compareItems({automatic:true}));
  },0);
}
function stopProviderWatch(){if(providerTimer){clearInterval(providerTimer);providerTimer=null;}$('stop-provider').hidden=true;}
function watchProvider(){
  stopProviderWatch();
  const job=state.collection;
  if(job?.source==='provider'&&state.providerJob?.manualUpload)return;
  const passive=job?.status==='paused'&&job.source==='provider'&&state.providerJob&&!['challenge','login','unsupported','query-changed','tab-closed','page-error','panel-closed'].includes(job.reason);
  if((job?.status==='paused'&&!passive)||(!job&&(!state.providerJob||state.providerJob.manualUpload)))return;
  $('stop-provider').hidden=passive||job?.source==='temu';
  providerTimer=setInterval(()=>{
    if(providerReading||(passive&&!busy))return;
    const task=state.collection?.source==='temu'?(!busy?readTemuCollection():Promise.resolve()):readProvider(false,{priceOnly:busy});
    task.catch(error=>{pauseCurrentCollection(/no tab with id|已关闭/i.test(error.message)?'tab-closed':'page-error');$('provider-status').textContent=error.message;});
  },2000);
}
function pauseCurrentCollection(reason='manual'){
  if(state.collection&&(state.collection.status==='running'||reason!=='manual'))pauseCollection(state.collection,reason);
  stopProviderWatch();watchProvider();render();save();requestAutoCompare();
}
function beginCollection(source,tabId,query=''){
  stopProviderWatch();
  if(state.collection){if(state.collection.status==='running')pauseCollection(state.collection,'manual');state.collectionHistory.push(state.collection);}
  state.collection=createCollection({source,tabId,query});state.collection.analysisTotal=state.items.length;
  if(state.items.length>=COLLECTION_LIMIT)pauseCollection(state.collection,'limit-reached');
  autoPaused=false;render();
}
function validCollectionPage(page,job=state.collection){
  if(job?.queryKey&&page.navigation?.queryKey!==job.queryKey){pauseCurrentCollection('query-changed');return false;}
  return true;
}
async function progressCollection(page,{allowBusy=false}={}){
  const job=state.collection;if(!job||job.status!=='running')return;
  const retained=new Set(state.items.filter(item=>(item.salesSource||'temu-visible')===(job.source==='provider'?'provider-visible':'temu-visible')).map(item=>item.id));
  job.productIds=[...new Set([...job.productIds,...(page.products||[]).map(item=>item.id)])].filter(id=>retained.has(id));
  const total=job.productIds.length;
  const decision=collectionDecision(job,page,{total,analysisTotal:state.items.length});
  if(decision==='advance'&&(!busy||allowBusy)){
    const response=await chrome.runtime.sendMessage({type:'advance-results',tabId:job.tabId,source:job.source,queryKey:job.queryKey});
    if(job!==state.collection||job.status!=='running')return;
    if(!response?.ok){pauseCollection(job,'page-error');$('provider-status').textContent=response?.error||'无法加载更多结果';}
    else recordCollectionAdvance(job,response.data);
  }
  if(job.status!=='running'){stopProviderWatch();watchProvider();}
  render();await save();requestAutoCompare();
}
async function readTemuCollection({allowBusy=false}={}){
  if(providerReading)return;
  const job=state.collection;if(job?.source!=='temu'||job.status!=='running')return;
  providerReading=true;
  try{
    const page=await collectTab(job.tabId);
    if(job!==state.collection||job.status!=='running'||!validCollectionPage(page,job))return;
    mergePage(page,job.query);await progressCollection(page,{allowBusy});
  }catch(error){if(job===state.collection)pauseCurrentCollection(error.message.includes('安全验证')?'challenge':'page-error');throw error;}
  finally{providerReading=false;requestAutoCompare();}
}
async function startProvider(){
  stopProviderWatch();
  if(state.collection?.status==='running')pauseCollection(state.collection,'manual');
  const current=state;
  const selection=state.selection||{};
  // Resolve the real title from the already open product/card before dispatch.
  // The provider's Temu tab uses this title to retrieve candidates.
  if(selection.productId&&selection.tabId)await ensureReferenceContext();
  if(state!==current||queuedSelection)return;
  const imageUrl=officialImage(selection.imageUrl||state.referenceImage);
  const captured=state.referenceContext?.productId===selection.productId?state.referenceContext:null;
  const capturedTitle=providerListingTitle(captured?.title);
  const title=capturedTitle||providerListingTitle(selection.title),titleSource=capturedTitle?'captured-product':selection.titleSource||'';
  warmReference();
  const url=providerSearchURL({...selection,imageUrl,title});
  const tab=await chrome.tabs.create({url,active:false,windowId});
  if(state!==current)return;
  state.providerJob={tabId:tab.id,selectionId:selection.id||'upload-'+Date.now(),expectedImageUrl:imageUrl,manualUpload:!imageUrl,submittedInput:{imageUrl,title:new URL(url).searchParams.get('title')||'',titleSource,productId:selection.productId||'',productIdSource:selection.productIdSource||'',sourcePageUrl:selection.pageUrl||'',submittedUrl:url},startedAt:new Date().toISOString(),lastFingerprint:''};
  state.imageSearchDiagnostics={submittedInput:state.providerJob.submittedInput,observations:[]};
  if(imageUrl)beginCollection('provider',tab.id);else state.collection=null;
  $('provider-status').textContent='图搜页已在后台打开。'+(imageUrl?(title?'已提交所选图片与原标题，正在等待页面结果。':'已提交所选图片，但未读取到原标题；第三方可能推导无关检索词，请查看本次查询输入。')+'需要登录或验证时，点击“查看图搜页”处理。':'点击“去图搜页上传图片”上传同一张本地图片，完成后回来点“已上传，继续查找”。');
  render();await save();watchProvider();
}
function providerReviewKey(product){
  const listing=listingMetadata({title:product.title,text:product.detailsText||product.rawText||'',structuredSpecs:product.structuredSpecs,listingFields:product.listingFields});
  const fields=Object.entries(listing.fields).map(([key,field])=>[key,field.value,field.status,field.evidence.map(evidence=>evidence.value)]);
  // Visible sales, price and keyword text are not image-identity inputs.
  return JSON.stringify([product.imageUrl,product.title,product.verifiedImages||[],product.variantAmbiguous||false,fields]);
}
function mergeProvider(page){
  const byId=new Map(state.items.filter(item=>item.salesSource==='provider-visible').map(item=>[item.id,item]));
  for(const product of limitedCandidates(page.products,state.items,'provider-visible')){
    const reviewKey=providerReviewKey(product);
    const existing=byId.get(product.id);
    if(existing){
      const unchanged=existing.providerReviewKey?existing.providerReviewKey===reviewKey:existing.imageUrl===product.imageUrl&&(existing.providerTitle||existing.title)===product.title&&existing.rawText===product.rawText;
      const retained=unchanged?{status:existing.status,matchSource:existing.matchSource,evidence:existing.evidence,missing:existing.missing,differences:existing.differences,detailsText:existing.detailsText,variantAmbiguous:existing.variantAmbiguous,title:existing.title,priceText:existing.priceText,price:existing.price,priceObservations:existing.priceObservations}:{};
      if(unchanged&&existing.detailSourceUrl){retained.structuredSpecs=existing.structuredSpecs;retained.listingFields=existing.listingFields;retained.verifiedImages=existing.verifiedImages;}
      // Late-rendered prices refresh independently of image confirmation.
      const previousPrice=existing.price;
      Object.assign(existing,product,retained);
      if(product.priceText&&product.price?.kind!=='unknown'){
        if(previousPrice?.raw&&previousPrice.raw!==product.price.raw)existing.priceObservations=[...(existing.priceObservations||[]),previousPrice].slice(-12);
        existing.priceText=product.priceText;existing.price=product.price;
      }else if(previousPrice?.raw){existing.priceText=previousPrice.raw;existing.price=previousPrice;}
      existing.providerTitle=product.title;existing.providerReviewKey=reviewKey;if(!unchanged){delete existing.autoAttempt;delete existing.pageImagePriority;}
    }else{const item={...product,providerTitle:product.title,providerReviewKey:reviewKey};state.items.push(item);byId.set(item.id,item);}
  }
  // Unassociated page-wide words cannot be attributed to any best-selling product.
  if(!state.pages.some(item=>item.url===page.pageUrl))state.pages.push({url:page.pageUrl,capturedAt:page.capturedAt,source:'provider-visible',query:'图片检索'});
  state.lastRun=new Date().toISOString();render();
}
async function readProvider(manual=false,{priceOnly=false}={}){
  if(providerReading)return;
  const job=state.providerJob;
  if(!job)throw new Error('请在“更多操作与说明”中点击“重新打开图搜”');
  if(job.manualUpload&&!manual)return;
  if(manual&&!priceOnly){
    if(state.collection?.source!=='provider'||state.collection.tabId!==job.tabId)beginCollection('provider',job.tabId);
    else resumeCollection(state.collection);
  }
  providerReading=true;
  try{
    const response=await chrome.runtime.sendMessage({type:'collect-provider',tabId:job.tabId});
    if(job!==state.providerJob)return;
    if(!response?.ok){
      if(response?.error?.includes('图搜标签页已关闭')){stopProviderWatch();state.providerJob=null;await save();}
      throw new Error(response?.error||'图搜页面读取失败');
    }
    const page=response.data;
    if(job.expectedImageUrl&&page.state==='results'&&page.queryImageUrl!==job.expectedImageUrl){pauseCurrentCollection('query-changed');throw new Error('当前图搜页的图片与本次选图不一致，请点击“重新查找同款”。');}
    if(page.state==='challenge'||page.state==='unsupported'||page.state==='login'){pauseCurrentCollection(page.state);$('provider-status').textContent=page.message+' 点击“查看图搜页”处理后再继续读取。';return;}
    if(!validCollectionPage(page))return;
    if(page.state!=='results'){$('provider-status').textContent=page.message;if(!priceOnly)await progressCollection(page);if(manual)watchProvider();return;}
    const prefs=(await chrome.storage.local.get('preferences')).preferences||{};
    if(job!==state.providerJob)return;
    const data=normalizeProviderPage(page,prefs.providerPeriod||'unknown');
    const observed={pageUrl:page.pageUrl,queryTitle:page.queryTitle||'',captureScope:page.captureScope||'visible-product-cards',currencies:[...new Set(data.products.map(item=>item.price?.currency).filter(Boolean))].sort()};
    const diagnostics=state.imageSearchDiagnostics||{submittedInput:job.submittedInput,observations:[]};
    const previous=diagnostics.observations.at(-1);
    const {capturedAt:previousTime,...lastObserved}=previous||{};
    if(!previous||JSON.stringify(observed)!==JSON.stringify(lastObserved)){
      diagnostics.observations=[...diagnostics.observations,{...observed,capturedAt:page.capturedAt}].slice(-5);
      state.imageSearchDiagnostics=diagnostics;await save();
    }
    if(job!==state.providerJob)return;
    if(priceOnly){
      // Refresh captured prices during long inference without changing its
      // images, identity text, candidate list or confirmation evidence.
      let refreshed=0;
      for(const product of data.products){
        const item=state.items.find(value=>value.id===product.id&&value.salesSource==='provider-visible'&&value.imageUrl===product.imageUrl&&(value.providerTitle||value.title)===product.title);
        if(!item||!product.priceText||product.price?.kind==='unknown')continue;
        if(item.price?.raw&&item.price.raw!==product.price.raw)item.priceObservations=[...(item.priceObservations||[]),item.price].slice(-12);
        item.priceText=product.priceText;item.price=product.price;refreshed++;
      }
      render();await save();$('provider-status').textContent='核对期间已同步 '+refreshed+' 个商品的页面价格。';if(manual)watchProvider();return;
    }
    const fingerprint=JSON.stringify([data.products.map(item=>[item.id,item.imageUrl,item.title,item.rawText,item.priceText,item.price?.currency,item.sales,item.market,item.productKeywords?.map(({capturedAt,...word})=>word),item.listingFields,item.structuredSpecs,item.verifiedImages]),data.keywords.map(item=>[item.query,item.metrics])]);
    if(fingerprint!==job.lastFingerprint){job.lastFingerprint=fingerprint;mergeProvider(data);await save();}
    await progressCollection(data);
    const currencies=[...new Set(data.products.map(item=>item.price?.currency).filter(currency=>currency&&currency!=='USD'))];
    $('provider-status').textContent='本次分析最多保留 '+COLLECTION_LIMIT+' 条候选。'+collectionText(state.collection)+' 第三方普通列表按标题检索，可能含无关商品，后续会自动核对图片。'+(currencies.length?' 页面价格含 '+currencies.join(' / ')+'，与美元口径不同；请核对第三方及TEMU的地区/货币设置。':'');
    if(manual){
      if(page.queryImageUrl){job.expectedImageUrl=page.queryImageUrl;job.manualUpload=false;watchProvider();}
      else{job.manualUpload=true;pauseCurrentCollection('navigation-unavailable');$('provider-status').textContent+=' 页面未提供本次图片关联，后续结果需手动读取。';}
      await save();
    }
  }finally{providerReading=false;requestAutoCompare();}
}
async function acceptSelection(value){
  if(value.windowId!==windowId||state.selection?.id===value.id)return;
  cancelReferenceWarmup();
  queuedSelection=value;
  if(busy){cancelled=true;for(const controller of requestControllers)controller.abort();return;}
  if(selectionProcessing)return;
  selectionProcessing=true;
  try{while(queuedSelection){
    const selected=queuedSelection;queuedSelection=null;cancelled=false;stopProviderWatch();
    autoPending=false;autoPaused=false;activity=null;analysisError='';waitingForService=false;resultTab='same';resultsCollapsed=false;closeImagePreview();
    state={...emptyState(),referenceImage:selected.imageUrl,selection:selected,profile:{name:selected.title||'网页选中商品',description:'已提取网页商品图片，结果出现后自动核对。'}};
    await loadManualMemory();if(queuedSelection)continue;
    for(const key of SPEC_KEYS)$('spec-'+key).value='';
    render();status('已选中网页商品图片。正在打开选品助手图搜…');
    const prefs=(await chrome.storage.local.get('preferences')).preferences||{};
    if(queuedSelection)continue;
    if(prefs.onImageClick==='local'){status('图片已提取。可打开图搜，或读取当前 TEMU 页。');await save();}
    else await startProvider();
  }}catch(error){status(error.message,true);}finally{selectionProcessing=false;requestAutoCompare();}
}

async function collectTab(tabId,selectedImageUrl=''){
  const response=await chrome.runtime.sendMessage({type:'collect',tabId,selectedImageUrl});
  if(!response?.ok)throw new Error(response?.error||'读取页面失败');
  if(response.data.challenge){await chrome.tabs.update(tabId,{active:true});tempTabs.delete(tabId);throw new Error('TEMU 出现安全验证，请在该页面自行完成验证，再点“读取当前 TEMU 页”');}
  return response.data;
}
function mergePage(page,query=''){
  const incoming=page.detail&&new URL(page.pageUrl).searchParams.has('goods_id')?[page.detail]:page.products;
  if(page.detail&&/-g-\d+\.html/.test(new URL(page.pageUrl).pathname))incoming.splice(0,incoming.length,page.detail);
  const byId=new Map(state.items.filter(item=>(item.salesSource||'temu-visible')==='temu-visible').map(item=>[item.id,item]));
  const product=page.detail;
  if(product)for(const saved of state.items.filter(item=>item.id===product.id)){
      // Enrich the already loaded product without copying another source's price,
      // sales window, picture, status or title into an in-flight comparison.
      saved.detailsText=product.detailsText||product.rawText;saved.structuredSpecs=product.structuredSpecs;saved.listingFields=product.listingFields||[];saved.verifiedImages=product.verifiedImages||[];saved.variantAmbiguous=product.variantAmbiguous;
      saved.detailSourceUrl=product.sourceUrl||page.pageUrl;saved.detailCapturedAt=product.capturedAt||page.capturedAt;
  }
  const admitted=limitedCandidates(incoming,state.items);
  for(const product of admitted){
    const existing=byId.get(product.id);
    if(existing){existing.queries=[...new Set([...(existing.queries||[]),...(query?[query]:[])])];continue;}
    const item={...product,price:priceObservation(product.priceText,{market:product.market,currency:product.priceCurrency,source:product.priceSource||'visible-page',sourceUrl:page.pageUrl,capturedAt:product.capturedAt}),sales:parseSales(product.rawText),queries:query?[query]:[],status:'unreviewed',missing:[],evidence:[],matchSource:null};
    state.items.push(item);byId.set(item.id,item);
  }
  if(!state.pages.some(item=>item.url===page.pageUrl))state.pages.push({url:page.pageUrl,capturedAt:page.capturedAt,query});
  state.lastRun=new Date().toISOString();render();
  return admitted.length;
}
async function waitForTab(tabId){
  const start=Date.now();
  while(Date.now()-start<35000){
    checkCancelled();
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='complete')return;
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw new Error('TEMU 页面加载超时，请打开该页面后重试');
}
// Navigation belongs only to the user's explicit keyword-search action.
// Product matching has no page loader and cannot request product HTML.
async function loadSearchPage(url,query=''){
  const target=new URL(url);
  if(target.origin!=='https://www.temu.com'||target.pathname!=='/search_result.html')throw new Error('此入口仅支持手动关键词搜索页');
  const tab=await chrome.tabs.create({url,active:false});tempTabs.add(tab.id);
  try{
    await waitForTab(tab.id);
    for(let attempt=0;attempt<5;attempt++){
      const page=await collectTab(tab.id);
      if(page.products.length){
        beginCollection('temu',tab.id,query);mergePage(page,query);await progressCollection(page,{allowBusy:true});
        // Keep this normal search tab open through all of its loaded result pages.
        while(state.collection?.status==='running'&&state.collection.tabId===tab.id){
          checkCancelled();await new Promise(resolve=>setTimeout(resolve,2000));checkCancelled();
          await readTemuCollection({allowBusy:true});
        }
        return page;
      }
      await new Promise(resolve=>setTimeout(resolve,600));
    }
    await chrome.tabs.update(tab.id,{active:true});tempTabs.delete(tab.id);
    throw new Error('页面未展示可读取商品。请确认 TEMU 已选择美国站，关闭遮挡弹窗或完成登录后再读取当前页。');
  }finally{
    if(tempTabs.has(tab.id)){
      tempTabs.delete(tab.id);
      // Retain the results tab so paused/exhausted searches can actually resume.
      if(state.collection?.tabId!==tab.id)await chrome.tabs.remove(tab.id).catch(()=>{});
    }
  }
}
async function compareItems({automatic=false}={}){
  setActivity('images','正在准备参考图与已读取的商品信息…');
  await ensureReferenceContext();
  await ensureReferenceImage();
  warmReference();
  const prefs=(await chrome.storage.local.get('preferences')).preferences||{};
  const maxCandidates=Math.max(1,Math.min(40,Number(prefs.maxCandidates)||12));
  state.referenceSpecs=getSpecs();
  const referenceTitle=state.referenceContext?.title||state.selection?.title||'';
  // Titles are evaluated before any candidate image request. Preserve the cheap
  // same-photo path even for weak titles; title mismatch never proves different.
  const available=state.items.filter(item=>!manualDecision(item)&&['unreviewed','pending'].includes(item.status)&&(!automatic||item.autoAttempt!==state.matchRevision));
  for(const item of available){
    const listing=listingMetadata({title:item.title,text:item.detailsText||item.rawText||'',structuredSpecs:item.structuredSpecs,listingFields:item.listingFields});
    const brand=listing.fields.brand.status==='listed'?listing.fields.brand.value:'';
    item.titleEvidence=titleMatchEvidence(referenceTitle,item.title,state.referenceSpecs.brand,brand);
  }
  const titleOrder=(a,b)=>Number(b.titleEvidence?.similar)-Number(a.titleEvidence?.similar)||(b.titleEvidence?.score||0)-(a.titleEvidence?.score||0);
  const pool=available.sort(titleOrder).slice(0,Math.min(60,maxCandidates*3));
  prefetchImages(pool);
  status('标题初筛完成，优先核对标题关键描述相近的商品…');
  let cursor=0,prioritized=0;
  await Promise.all(Array.from({length:Math.min(2,pool.length)},async()=>{
    while(cursor<pool.length){
      checkCancelled();const item=pool[cursor++];prefetchImages(pool.slice(cursor,cursor+3));
      try{
        let priority=item.pageImagePriority;
        if(priority?.revision!==state.matchRevision||priority?.imageUrl!==item.imageUrl){
          const result=await api('/compare',{phase:'image-priority',referenceImage:state.referenceImage,referenceImageUrl:state.selection?.imageUrl,imageUrl:item.imageUrl});
          priority=item.pageImagePriority={revision:state.matchRevision,imageUrl:item.imageUrl,imageSimilarity:result.comparison.imageSimilarity,samePhoto:result.comparison.samePhoto};
        }
        item.imageSimilarity=priority.imageSimilarity;item.samePhoto=priority.samePhoto;item.priorityScore=item.samePhoto?1:item.imageSimilarity;delete item.subject;delete item.priorityError;
      }catch(error){if(cancelled||error.serviceUnavailable)throw error;item.priorityError=error.message;item.status='pending';item.autoAttempt=state.matchRevision;item.missing=['图片读取失败：'+error.message];}
      prioritized++;status('图片初筛 '+prioritized+' / '+pool.length+'，准备优先核对外观最接近的商品…');
      setActivity('images','本批图片初筛 '+prioritized+' / '+pool.length+' 条。初筛后继续核对商品本身。');
    }
  }));
  if(automatic&&state.collection?.status==='running'){requestAutoCompare();return;}
  const candidates=pool.filter(item=>!item.priorityError).sort((a,b)=>titleOrder(a,b)||(b.priorityScore||0)-(a.priorityScore||0)).slice(0,maxCandidates);
  if(!candidates.length&&pool.length){status('本批商品图片无法读取，已记录原因');if(automatic)requestAutoCompare();return;}
  state.referenceSpecs=getSpecs();
  let processed=0,failures=0;
  let review=[];
  for(const item of candidates){
    if(automatic&&state.collection?.status==='running'){requestAutoCompare();return;}
    checkCancelled();if(manualDecision(item))continue;processed++;
    delete item.subjectAttempt;delete item.outlineMatch;delete item.instanceMatch;delete item.matchedReferenceImageUrl;delete item.referenceEvidence;delete item.listingColorMatch;
    status('页面图片匹配 '+processed+' / '+candidates.length+'：'+item.title.slice(0,55));
    delete item.serviceInterrupted;
    setActivity('images','本批图片匹配 '+processed+' / '+candidates.length+' · '+item.title.slice(0,55));
    try{
      const first=await api('/compare',{phase:'page-match',candidateId:item.id,referenceImage:state.referenceImage,referenceImageUrl:state.selection?.imageUrl,referenceSpecs:state.referenceSpecs,imageUrl:item.imageUrl,candidateText:comparisonText(item)});
      Object.assign(item,first.comparison,{matchSource:'automated'});
      if(item.variantAmbiguous&&item.status==='exact'){item.status='visual-match';item.missing=['多规格商品，具体 SKU / 对应价格未绑定'];}
      // Matching uses only captured card/detail snapshots and image URLs.
      // Missing listing fields never cause navigation to a product page.
      if(state.referenceContext?.variantAmbiguous&&item.status==='exact'){item.status='visual-match';item.missing=['原商品包含多个 SKU，具体规格未绑定'];}
    }catch(error){
      if(cancelled)throw error;
      if(error.serviceUnavailable){item.serviceInterrupted=true;delete item.autoAttempt;throw error;}
      failures++;item.missing=[...(item.missing||[]),'读取或核对失败：'+error.message];
      if(!isProductMatch(item))item.status='pending';
      if(error.message.includes('安全验证')||error.message.includes('本机识别初始化失败')){render();await save();throw error;}
    }finally{if(!cancelled&&!item.serviceInterrupted)item.autoAttempt=state.matchRevision;}
    if(item.status==='pending'&&!item.priorityError)review.push(item);
    render();await save();
  }
  // Complete all currently loaded candidates through the original page-image
  // path before any slow subject review, including across automatic batches.
  if(state.items.some(needsPageReview)){
    status('本批页面图片匹配完成，继续处理其余候选；主体核对将在页面图片匹配后进行。');
    requestAutoCompare();return;
  }
  if(automatic)review=state.items.filter(needsSubjectReview);
  review.sort(titleOrder);
  let reviewed=0,reviewCursor=0,inFlight=0,reviewError;
  const batch=new AbortController();
  await Promise.all(Array.from({length:Math.min(3,review.length)},async()=>{
  while(reviewCursor<review.length&&!reviewError){
    if(automatic&&state.collection?.status==='running'){requestAutoCompare();return;}
    try{checkCancelled();}catch(error){reviewError??=error;batch.abort(error);return;}
    const item=review[reviewCursor++];if(manualDecision(item)){reviewed++;continue;}inFlight++;
    prefetchImages(review.slice(reviewCursor,reviewCursor+3));
    status('三路核对 · 已完成 '+reviewed+' / '+review.length+' · 正在处理 '+inFlight+' 条');
    delete item.serviceInterrupted;
    setActivity('subject','三路核对 · 本批已完成 '+reviewed+' / '+review.length+' · 正在处理 '+inFlight+' 条');
    let completed=false;
    try{
      const result=await api('/compare',{phase:'subject-review',candidateId:item.id,referenceImage:state.referenceImage,referenceImageUrl:state.selection?.imageUrl,referenceTitle,candidateTitle:item.title,referenceImages:['public-jsonld','bound-current-product-gallery'].includes(state.referenceContext?.imageSource)?state.referenceContext.referenceImages||[]:[],referenceImageSource:state.referenceContext?.imageSource||'',referenceSpecs:state.referenceSpecs,imageUrl:item.imageUrl,candidateImages:item.verifiedImages||[],candidateText:comparisonText(item)},{signal:batch.signal});
      checkCancelled();batch.signal.throwIfAborted();
      delete item.outlineMatch;Object.assign(item,result.comparison,{matchSource:'automated'});
      if((item.variantAmbiguous||state.referenceContext?.variantAmbiguous)&&item.status==='exact'){item.status='visual-match';item.missing=['多规格商品，具体 SKU / 对应价格未绑定'];}
      completed=true;
    }catch(error){
      if(cancelled||batch.signal.aborted||error.serviceUnavailable||error.message.includes('本机识别初始化失败')){
        item.serviceInterrupted=true;delete item.subjectAttempt;reviewError??=error;batch.abort(reviewError);
      }else{failures++;item.missing=[...(item.missing||[]),'后续主体核对失败：'+error.message];completed=true;}
    }finally{inFlight--;if(completed&&!cancelled){item.subjectAttempt=state.matchRevision;reviewed++;}}
    setActivity('subject','三路核对 · 本批已完成 '+reviewed+' / '+review.length+' · 正在处理 '+inFlight+' 条');
    render();await save();
  }
  }));
  if(reviewError)throw reviewError;
  const exact=state.items.filter(isProductMatch).length;
  const different=state.items.filter(isDifferent).length,unconfirmed=state.items.length-exact-different;
  const colorRuleCount=state.items.filter(item=>item.status==='rule-match').length;
  const outlineCount=state.items.filter(item=>item.status==='outline-match').length;
  status('本批自动核对 '+processed+' 个商品，同款匹配 '+exact+' 个'+(colorRuleCount?'（其中 '+colorRuleCount+' 个主体颜色补充）':'')+(outlineCount?'（其中 '+outlineCount+' 个主体轮廓补充）':'')+' · 未确认 '+unconfirmed+' 个 · 明确不同 '+different+' 个'+(failures?'；'+failures+' 个读取失败，已保留原因':'')+'。两组标题均已安排主体核对；数量和规格仅作附注。');
  if(automatic)requestAutoCompare();
}
function comparisonText(item){
  let text=item.detailsText||item.rawText||'';
  const info=listingMetadata({title:item.title,text,structuredSpecs:item.structuredSpecs,listingFields:item.listingFields});
  const labels={brand:'Brand',model:'Model',material:'Material',dimensions:'Dimensions',quantity:'Quantity'};
  const current=listingSpecs(text);
  for(const [key,label]of Object.entries(labels)){const field=info.fields[key];if(!current.specs[key]&&!current.conflicts.includes(key)&&field.value&&field.status==='listed'&&field.source!=='title-literal')text+='\n'+label+': '+field.value;}
  const specs=listingSpecs(text),quantity=titleQuantity(item.title);
  return quantity&&!specs.specs.quantity&&!specs.conflicts.includes('quantity')?text+'\nQuantity: '+quantity+'\n数量证据：商品标题原文 '+item.title:text;
}
async function search(){
  const queries=state.selectedQueries.slice(0,3);if(!queries.length)throw new Error('请选至少一组英文搜索词');
  state.lastRun=new Date().toISOString();render();
  for(let i=0;i<queries.length;i++){
    if(state.items.length>=COLLECTION_LIMIT)break;
    checkCancelled();status('检索关键词 '+(i+1)+' / '+queries.length+'：'+queries[i]);
    const url=new URL('https://www.temu.com/search_result.html');url.searchParams.set('search_key',queries[i]);
    await loadSearchPage(url.href,queries[i]);await save();
    if(['manual','limit-reached'].includes(state.collection?.reason))break;
  }
  if(!state.items.length)throw new Error('本次未读取到商品，请在 TEMU 搜索页确认页面已正常加载');
  await compareItems();
}
async function run(task){
  if(busy)return;cancelled=false;analysisError='';setBusy(true);renderProgress();
  try{await task();}catch(error){if(!cancelled)analysisError=error.message;if(error.serviceUnavailable){waitingForService=true;serviceAvailable=false;autoPending=false;}status(error.message,true);}finally{activity=null;setBusy(false);render();await save();if(queuedSelection){const value=queuedSelection;queuedSelection=null;await acceptSelection(value);}drainAutoCompare();}
}

async function checkHealth(){
  if(cancelled&&autoPaused){serviceAvailable=false;document.body.dataset.service='paused';$('service-status').textContent='识别已暂停 · 继续核对时自动准备';$('prepare-model').hidden=true;renderProgress();return;}
  try{
    const health=await engineRequest('/health');
    if(health.ok===false)throw new Error('识别引擎错误');
    const available=health.configured!==false&&health.model?.state!=='error';
    if(available){if(waitingForService)analysisError='';waitingForService=false;$('service-help').hidden=true;}
    if(available&&!serviceAvailable){serviceAvailable=true;requestAutoCompare();}else serviceAvailable=available;
    const local=health.engine==='local'||health.engine==='browser';
    document.body.dataset.service=local?health.model.state:health.configured?'ready':'offline';
    $('service-status').textContent=local?(health.model.state==='ready'?'本机识别已就绪':health.model.state==='loading'?'正在准备本机助手'+(Number.isFinite(health.model.progress)?' · '+health.model.progress+'%':''):health.model.message):'本机识别'+(health.configured?'已就绪':'待准备');
    $('prepare-model').hidden=!local||['loading','ready'].includes(health.model.state);
    if(!healthTimer)healthTimer=setInterval(checkHealth,5000);
  }catch{
    serviceAvailable=false;
    document.body.dataset.service='offline';
    $('service-status').textContent='后台暂未连接 · 正在尝试恢复';$('prepare-model').hidden=false;$('service-help').hidden=false;
    if(!healthTimer)healthTimer=setInterval(checkHealth,5000);
  }
  renderProgress();
}

$('upload').addEventListener('change',()=>run(async()=>{
  const file=$('upload').files?.[0];if(!file)return;
  if(file.size>8_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请使用 8 MB 以下的 PNG、JPG 或 WebP 图片');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
  cancelReferenceWarmup();stopProviderWatch();autoPending=false;autoPaused=false;activity=null;analysisError='';waitingForService=false;resultTab='same';resultsCollapsed=false;closeImagePreview();state={...emptyState(),referenceImage:data,referenceSpecs:getSpecs()};await loadManualMemory();
  render();status('图片已上传，图搜结果出现后工具会自动核对。');
}));
$('replace-image').addEventListener('click',()=>{$('upload').value='';$('upload').click();});
$('analyze').addEventListener('click',()=>run(startProvider));
$('collect').addEventListener('click',()=>run(async()=>{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)throw new Error('当前没有可读取的浏览器页');
  const page=await collectTab(tab.id);const query=new URL(page.pageUrl).searchParams.get('search_key')||'';
  if(query)addKeyword(query);
  if(page.navigation?.supported)beginCollection('temu',tab.id,query);
  const count=mergePage(page,query);
  if(!count&&state.items.length<COLLECTION_LIMIT)throw new Error('当前页面未展示可读取商品，请打开商品详情或搜索结果页，等待商品图片加载后重试');
  if(page.navigation?.supported){await progressCollection(page);watchProvider();}
  status('本次已保留 '+state.items.length+' 个真实商品（最多 '+COLLECTION_LIMIT+' 条）'+(state.collection?.status==='running'?'，正在继续采集后续结果。':'，正在自动比对。'));requestAutoCompare();
}));
function recheckCollected(){if(busy)return;pauseCurrentCollection();autoPaused=false;run(async()=>{for(const item of state.items)delete item.autoAttempt;await compareItems({automatic:true});});}
$('compare-collected').addEventListener('click',recheckCollected);
$('resume-analysis').addEventListener('click',recheckCollected);
$('search-keywords').addEventListener('click',()=>run(search));
$('provider-search').addEventListener('click',()=>run(startProvider));
$('show-provider').addEventListener('click',async()=>{
  const job=state.providerJob;if(!job)return;
  try{await chrome.tabs.update(job.tabId,{active:true});}
  catch{if(job===state.providerJob)$('provider-status').textContent='无法显示图搜页，标签页可能已关闭，请在“更多操作与说明”中点击“重新打开图搜”。';}
});
$('read-provider').addEventListener('click',()=>{if(busy){
  if(state.providerJob){if(state.collection?.source!=='provider'||state.collection.tabId!==state.providerJob.tabId)beginCollection('provider',state.providerJob.tabId);else resumeCollection(state.collection);watchProvider();}
  readProvider(true,{priceOnly:true}).catch(error=>{$('provider-status').textContent=error.message;});return;
}autoPaused=false;run(()=>readProvider(true));});
$('stop-provider').addEventListener('click',()=>{pauseCurrentCollection();$('provider-status').textContent='已暂停采集。已抓取商品会自动核对，可继续采集后续结果。';});
$('stop-collection').addEventListener('click',()=>pauseCurrentCollection());
$('resume-collection').addEventListener('click',()=>{if(!state.collection)return;if(state.items.length>=COLLECTION_LIMIT){pauseCurrentCollection('limit-reached');return;}resumeCollection(state.collection);autoPaused=false;render();save();watchProvider();});
window.addEventListener('pagehide',()=>{cancelled=true;for(const controller of requestControllers)controller.abort();removeEngineConnection();closeImagePreview();closeEngine();autoPaused=true;if(state.collection?.status==='running')pauseCollection(state.collection,'panel-closed');stopProviderWatch();save();if(autoTimer)clearTimeout(autoTimer);if(healthTimer)clearInterval(healthTimer);});
$('add-keyword').addEventListener('click',()=>{addKeyword($('manual-keyword').value);$('manual-keyword').value='';renderKeywords();save();});
$('manual-keyword').addEventListener('keydown',event=>{if(event.key==='Enter')$('add-keyword').click();});
$('cancel').addEventListener('click',()=>{cancelled=true;autoPaused=true;autoPending=false;waitingForService=false;$('service-help').hidden=true;pauseCurrentCollection();for(const controller of requestControllers)controller.abort();closeEngine();status('正在停止本次检索…');});
$('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
$('result-sort').addEventListener('change',render);
$('toggle-results').addEventListener('click',()=>{
  resultsCollapsed=!resultsCollapsed;closeImagePreview();renderResultsVisibility();
  if(resultsCollapsed){if(!$('keyword-section').hidden)$('keyword-section').open=true;$('results-section').scrollIntoView?.({block:'start'});}
});
for(const type of ['mouseover','focusin'])document.addEventListener(type,event=>{const image=event.target.closest?.('img.previewable-image');if(image)showImagePreview(image,event.type==='mouseover'&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)?{x:event.clientX,y:event.clientY}:null);});
for(const type of ['mouseout','focusout'])document.addEventListener(type,event=>{if(event.target===previewAnchor&&event.relatedTarget!==previewAnchor)closeImagePreview();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeImagePreview();});
document.addEventListener('scroll',scrollImagePreview,true);
window.addEventListener('resize',closeImagePreview);
window.addEventListener('blur',closeImagePreview);
$('image-preview-image').addEventListener('error',closeImagePreview);
for(const button of document.querySelectorAll('[data-result-tab]')){
  button.addEventListener('click',()=>{resultTab=button.dataset.resultTab;render();});
  button.addEventListener('keydown',event=>{
    const names=['same','pending','different'],index=names.indexOf(resultTab);
    const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:-1;
    if(next<0)return;event.preventDefault();resultTab=names[next];render();$('tab-'+resultTab).focus();
  });
}
$('prepare-model').addEventListener('click',()=>run(async()=>{await api('/prepare',{});await checkHealth();status('本机助手已就绪，可以查找商品。');}));
$('export').addEventListener('click',()=>{
  const data={version:'0.4.4',recognitionRuntime:'native-local-v1',engineRevision:ENGINE_REVISION,generatedAt:new Date().toISOString(),targetMarket:'us',coverage:'normally-loaded-search-results',siteWideComplete:false,collection:state.collection,collections:[...state.collectionHistory,...(state.collection?[state.collection]:[])],matchingPolicy:state.matchingPolicy,manualReferenceKey:state.manualReferenceKey,imageSearchInput:state.providerJob?.submittedInput||state.imageSearchDiagnostics?.submittedInput||null,imageSearchDiagnostics:state.imageSearchDiagnostics,candidateLimit:COLLECTION_LIMIT,keywordTopCount:10,reference:state.profile,referenceContext:state.referenceContext,referenceSpecs:getSpecs(),pages:state.pages,keywords:bestSellerKeywords(state.items),retrievalQueries:keywordMetrics(state.keywords,state.items),products:state.items.map(item=>({...item,effectiveStatus:effectiveMatchStatus(item),keywordEvidence:isProductMatch(item)&&effectiveMatchStatus(item)!=='inferred-match'?listingKeywordEvidence(item):[],listingInfo:listingMetadata({title:item.title,text:item.detailsText||item.rawText||'',structuredSpecs:item.structuredSpecs,listingFields:item.listingFields,sourceUrl:item.sourceUrl,capturedAt:item.capturedAt})}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='temu-exact-match-'+Date.now()+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
SPEC_KEYS.forEach(key=>$('spec-'+key).addEventListener('change',()=>{
  // Results from old reference specifications cannot survive a change in identity criteria.
  for(const item of state.items){item.status='unreviewed';item.matchSource=null;item.evidence=[];item.missing=[];}
  state.matchRevision++;render();save();requestAutoCompare();
}));
try{
  const stored=await chrome.storage.session.get([stateKey,'temuMatch']);const saved=stored[stateKey]||stored.temuMatch;
  if(saved?.referenceImage){state={...emptyState(),...saved};if(saved.keywordPolicy!=='best-sellers-v1'){state.keywords=[];state.selectedQueries=[];state.keywordSources={};state.keywordPolicy='best-sellers-v1';}for(const key of SPEC_KEYS)$('spec-'+key).value=state.referenceSpecs?.[key]||'';}
  state.items=state.items.slice(0,COLLECTION_LIMIT);
  if(state.collection){
    const retained=new Set(state.items.filter(item=>(item.salesSource||'temu-visible')===(state.collection.source==='provider'?'provider-visible':'temu-visible')).map(item=>item.id));
    state.collection.productIds=(state.collection.productIds||[]).filter(id=>retained.has(id));state.collection.total=state.collection.productIds.length;state.collection.analysisTotal=state.items.length;state.collection.limit=COLLECTION_LIMIT;
    if(state.items.length>=COLLECTION_LIMIT)pauseCollection(state.collection,'limit-reached');else if(state.collection.status==='running')pauseCollection(state.collection,'panel-closed');
  }
  if(saved&&(saved.matchingPolicy!==MATCHING_POLICY||saved.engineRevision!==ENGINE_REVISION)){state.matchingPolicy=MATCHING_POLICY;state.engineRevision=ENGINE_REVISION;for(const item of state.items){item.status='unreviewed';item.matchSource=null;item.evidence=[];item.missing=[];item.differences=[];delete item.subject;delete item.outlineMatch;delete item.fastMatch;delete item.instanceMatch;delete item.matchedReferenceImageUrl;delete item.referenceEvidence;delete item.titleEvidence;delete item.listingColorMatch;delete item.subjectReview;delete item.subjectDifferences;delete item.visualChecks;delete item.checks;delete item.listingDifferences;delete item.packDifference;delete item.priorityScore;delete item.pageImagePriority;delete item.matchStage;delete item.subjectAttempt;delete item.autoAttempt;}}
}catch{}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='session'&&changes[selectionKey]?.newValue)acceptSelection(changes[selectionKey].newValue);
  const key=memoryStorageKey(state.manualReferenceKey);
  if(area==='local'&&key&&changes[key]){manualReadEpoch++;acceptManualRecord(changes[key].newValue,{reset:changes[key].newValue===undefined});render();save();requestAutoCompare();}
});
await loadManualMemory();
render();
if(state.providerJob){$('provider-status').textContent=state.providerJob.manualUpload?'请到图搜页上传同一张图片。完成后回来，点“已上传，继续查找”。':state.collection?.reason==='login'?'图搜网站需要登录。点“查看图搜页”完成登录，再回来继续读取。':state.collection?.reason==='challenge'?'图搜网站需要验证。点“查看图搜页”完成验证，再回来继续读取。':'已恢复上次查找，点“继续读取结果”可接着处理。';if(!state.collection)watchProvider();}
const selected=(await chrome.storage.session.get(selectionKey))[selectionKey];if(selected)await acceptSelection(selected);
await checkHealth();
requestAutoCompare();
