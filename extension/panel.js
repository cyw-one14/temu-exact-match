import {SPEC_KEYS,parseSales,rankMatches,isProductMatch,keywordMetrics,bestSellerKeywords,listingSpecs,titleQuantity} from './core.mjs';
import {officialImage,providerSearchURL,normalizeProviderPage} from './provider.mjs';
import {priceObservation,priceKindLabel} from './prices.mjs';

const $=id=>document.getElementById(id);
const SERVICE='http://127.0.0.1:43187';
const windowId=(await chrome.windows.getCurrent()).id;
const stateKey='temuMatch:'+windowId,selectionKey='temuSelection:'+windowId;
const MATCHING_POLICY='product-attention-v11';
const emptyState=()=>({matchingPolicy:MATCHING_POLICY,matchRevision:1,referenceContext:null,keywordPolicy:'best-sellers-v1',referenceImage:'',referenceSpecs:{},profile:null,keywords:[],keywordSources:{},selectedQueries:[],items:[],pages:[],lastRun:null,selection:null,providerJob:null});
let state=emptyState();
let busy=false,cancelled=false,healthTimer=null;
let providerTimer=null,providerReading=false,queuedSelection=null,selectionProcessing=false;
let autoPending=false,autoTimer=null,autoPaused=false,serviceAvailable=false;
const requestControllers=new Set();
const tempTabs=new Set();

function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
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
async function api(path,body){
  checkCancelled();
  const controller=new AbortController();requestControllers.add(controller);
  const timeout=setTimeout(()=>controller.abort(),180_000);
  try{
    const response=await fetch(SERVICE+path,{method:body?'POST':'GET',headers:{'X-Temu-Client':'exact-match',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
    const result=await response.json();
    if(!response.ok||result.ok===false)throw new Error(result.error||'本机服务返回错误');
    return result;
  }catch(error){
    if(error.name==='AbortError')throw new Error(cancelled?'本次检索已停止':'识别服务响应超时，请稍后重试');
    if(error instanceof TypeError)throw new Error('无法连接本机识别服务，请先双击项目中的“启动服务.cmd”');
    throw error;
  }finally{clearTimeout(timeout);requestControllers.delete(controller);}
}
async function save(){
  state.referenceSpecs=getSpecs();
  try{await chrome.storage.session.set({[stateKey]:state});}catch{/* Large uploads remain in this open panel only. */}
}
function addKeyword(query){
  query=String(query||'').trim().slice(0,180);
  if(!query||state.keywords.includes(query))return;
  state.keywords.push(query);if(state.selectedQueries.length<3)state.selectedQueries.push(query);
}
function renderKeywords(){
  $('keyword-section').hidden=!state.referenceImage&&!state.items.length;
  const container=$('keywords');container.replaceChildren();
  const groups=bestSellerKeywords(state.items);
  $('keyword-caption').textContent='取销量前 3 款 · 按销量口径分组';
  if(!groups.length)container.append(node('p','hint','工具自动判断同款并读取销量后，再收集畅销商品的关键词。'));
  for(const group of groups){
    const first=group.products[0],section=node('div','seller-keywords');
    section.append(node('p','hint',(first.salesSource==='provider-visible'?'特卖数据图搜':'TEMU 页面')+' · '+(first.market==='us'?'美国站':'国家站未核实')+' · '+periodText(first.sales)+' · 已确认且有销量 '+group.eligibleProducts+' 款，取前 '+group.products.length+' 款'));
    if(group.products.some(item=>!item.sales.exact))section.append(node('p','hint','包含约数 / 销量下限，按页面显示数字排列，无法确认精确销量名次。'));
    if(!group.keywords.length)section.append(node('p','hint','这些商品暂无可读取的商品关键词或标题词。'));
    for(const word of group.keywords){
      const entry=node('div','keyword-source');entry.append(node('strong','',word.query));
      for(const source of word.sources){
        const link=node('a','','第 '+source.rank+' 款 · '+source.sales.raw+' · '+(source.matchStatus==='visual-match'?'外观同款 · ':'')+(source.kind==='product-keyword'?'商品页面关键词':'商品标题原词'));
        link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.title=source.title;entry.append(link);
      }
      const use=node('button','quiet','用此词检索');use.type='button';use.disabled=busy;
      use.addEventListener('click',()=>{addKeyword(word.query);renderKeywords();save();});entry.append(use);section.append(entry);
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
function safeImage(raw){if(typeof raw==='string'&&raw.length<500000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw))return raw;try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function periodText(sales){return sales?.periodLabel||({'30d':'近 30 天','7d':'近 7 天','1d':'日销量',total:'累计销量'})[sales?.period]||'销量统计周期未展示';}
function node(tag,cls,text){const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;}

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
  if(lead){
    const caption=item.sales?.kind==='unknown'?'完全同款 · 页面未提供销量':item.sales?.kind==='approximate'?'页面显示销量数字最高 · 约数，精确名次未确认':item.sales?.kind==='lower-bound'?'页面显示销量数字最高 · 销量下限，精确名次未确认':item.sales?.period==='unknown'?'页面显示销量数字最高 · 统计周期未知':'同一销量口径内 · 页面显示销量数字最高';
    article.append(node('div','lead-title',caption));
  }
  const top=node('div','product-top');const image=node('img');image.alt=item.title;image.src=safeImage(item.matchedImageUrl||item.imageUrl);image.loading='lazy';image.referrerPolicy='no-referrer';top.append(image);
  const info=node('div');info.append(node('div','product-name',item.title));
  const price=item.price||priceObservation(item.priceText,{market:item.market});
  info.append(node('div','product-price',price.raw||'价格未读取'));
  info.append(node('p','hint',priceKindLabel(price)+(price.currency?' · '+price.currency:' · 币种未确认')+' · 尚未绑定具体 SKU / 优惠条件'));
  const meta=node('div','product-meta');
  meta.append(node('span','',item.sales?.raw||'销量未展示'));info.append(meta);
  const badge=item.status==='exact'?'同款 · 图片主体一致 · 自动确认':item.status==='visual-match'?(item.matchStage==='page-image'?'同款 · 同图匹配 · 自动确认':item.fastMatch?.matched?'同款 · 主体一致 · 快速图像核验':'同款 · 主体一致 · 自动核对'):item.status==='different'?'已排除 · '+(item.reason||'图片主体存在差异'):item.autoAttempt===state.matchRevision?'无法自动确认 · 不参与推荐':'等待工具自动核对';
  info.append(node('span','badge',badge));top.append(info);article.append(top);
  article.append(node('p','product-note',(item.salesSource==='provider-visible'?'来源：特卖数据图搜':'来源：TEMU 页面')+' · '+(item.market==='us'?'美国站':'国家站尚未核实')+' · '+periodText(item.sales)+' · 采集 '+new Date(item.capturedAt).toLocaleString('zh-CN')));
  if(price.sourceUrl)article.append(node('p','product-note','价格来源：'+(price.source==='provider-visible'?'特卖数据页面':'TEMU 商品页')+' · '+new Date(price.capturedAt).toLocaleString('zh-CN')));
  if(item.status==='visual-match')article.append(node('p','hint',item.variantAmbiguous||state.referenceContext?.variantAmbiguous?'图片主体匹配；商品含多个 SKU，尺寸 / 套装与对应价格未绑定。':'图片主体匹配；未展示的品牌 / 尺寸 / 材质 / 数量单独保留未知。'));
  if(item.packDifference)article.append(node('p','hint','售卖数量不同：参考 '+item.packDifference.reference+'，此链接 '+item.packDifference.candidate+'。保留该链接的原页面价格，具体 SKU 未绑定，未折算单件价。'));
  if(item.salesSource==='provider-visible'&&item.sales?.kind==='unknown')article.append(node('p','hint','该商品未展示所选销量周期，不使用其他周期补齐。'));
  const details=node('details');details.append(node('summary','',item.status==='different'?'查看差异':'查看核对依据'));
  const evidence=node('ul','evidence-list');
  const lines=[...(item.evidence||[]),...(item.differences||[]),...(item.missing||[]).map(value=>'无法确认：'+value)];
  if(!lines.length)lines.push('等待图片与规格核对');
  for(const text of lines.slice(0,16))evidence.append(node('li','',text));
  details.append(evidence);
  if(item.subject?.valid){
    details.append(node('p','hint',(item.subject.attention?.applied?'商品区域加权特征':'主体特征')+'余弦值 '+item.subject.subjectSimilarity.toFixed(3)+' · 局部特征 '+item.subject.localSimilarity.toFixed(3)+' · 颜色分布 '+item.subject.colorSimilarity.toFixed(3)+'（特征分数，不是同款概率）'));
    const previews=node('div','subject-previews');for(const [label,src]of [['参考前景（原图保留）',item.subject.referencePreview],['候选前景（原图保留）',item.subject.candidatePreview]])if(src?.startsWith('data:image/png;base64,')){const img=node('img');img.alt=label;img.src=src;previews.append(img);}details.append(previews);
  }
  if(item.subject?.attention)details.append(node('p','hint',item.subject.attention.applied?'已降低明确人体区域的比对权重；图片中的手仍保留，商品细节不足时继续显示无法确认。':item.subject.attention.reason));
  if(item.rawText)details.append(node('p','hint','页面原文：'+item.rawText.slice(0,1600)));
  article.append(details);
  const actions=node('div','product-actions');
  const link=node('a','','打开商品链接 ↗');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
  const copy=node('button','','复制完整标题');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(item.title);status('已复制商品原始标题');}catch{status('无法复制，请直接选中标题复制',true);}});actions.append(copy);
  article.append(actions);return article;
}

function render(){
  $('reference').hidden=!state.referenceImage;
  document.querySelector('.upload-label').hidden=Boolean(state.referenceImage);
  if(state.referenceImage)$('reference-image').src=state.referenceImage;
  $('reference-name').textContent=state.profile?.name||'待识别产品';
  $('reference-description').textContent=state.referenceContext?.message||state.profile?.description||'工具会自动比对图片；网页商品还会自动读取原商品信息。';
  renderKeywords();
  $('results-section').hidden=!state.items.length&&!state.lastRun;
  const exact=rankMatches(state.items),pending=state.items.filter(item=>!isProductMatch(item)&&item.status!=='different'),different=state.items.filter(item=>item.status==='different');
  $('count').textContent=exact.length+' 个同款匹配';
  $('scope').textContent='已读取 '+state.items.length+' 个商品 · '+state.pages.length+' 个页面 · 仅覆盖已加载结果；国家站、数据来源和销量周期分别处理。';
  const order=$('result-sort').value||'match';
  const ordered=[...exact].sort((a,b)=>order==='sales'?0:order==='price'?(a.price?.currency==='USD'&&['displayed','range','starting'].includes(a.price.kind)?a.price.low:Infinity)-(b.price?.currency==='USD'&&['displayed','range','starting'].includes(b.price.kind)?b.price.low:Infinity):Number(Boolean(b.samePhoto))-Number(Boolean(a.samePhoto))||Number(b.status==='exact')-Number(a.status==='exact')||(b.imageSimilarity||0)-(a.imageSimilarity||0));
  $('exact-results').replaceChildren(...ordered.map(item=>card(item,false)));
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
  $('pending-count').textContent='自动处理 / 无法确认（显示 '+shownPending.length+' / 共 '+pending.length+'）';$('pending-section').hidden=!pending.length;
  $('excluded-count').textContent='已排除商品（'+different.length+'）';$('excluded-section').hidden=!different.length;
  $('empty').hidden=exact.length>0;
  setBusy(busy);
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
  if(state.referenceContext)return;
  if(!selection?.productId){state.referenceContext={message:'本地图片不包含商品详情；不可见规格会保留为未知。'};return;}
  status('正在自动读取原商品信息…');
  try{
    let page;
    try{if(selection.tabId)page=await collectTab(selection.tabId);}catch(error){if(cancelled)throw error;}
    checkCancelled();if(current!==state)return;
    const detail=page?.detail?.id===selection.productId?page.detail:page?.products?.find(item=>item.id===selection.productId);
    if(!detail)throw new Error('已打开页面未提供所选商品信息，使用抓取图片核对，不另开详情页');
    const parsed=listingSpecs(detail.detailsText||detail.rawText,detail.structuredSpecs);
    const quantity=titleQuantity(detail.title);
    if(quantity&&!parsed.specs.quantity&&!parsed.conflicts.includes('quantity')){parsed.specs.quantity=quantity;parsed.evidence.push({key:'quantity',value:quantity,evidence:detail.title,source:'title'});}
    state.referenceContext={productId:detail.id,title:detail.title,text:detail.detailsText||detail.rawText,evidence:parsed.evidence,variantAmbiguous:detail.variantAmbiguous,sourceUrl:detail.sourceUrl,capturedAt:detail.capturedAt,message:'已自动读取原商品信息；未展示的规格保留未知'+(detail.variantAmbiguous?'，原商品包含多个规格，无法确定图片对应的 SKU':'')+'。'};
    for(const key of SPEC_KEYS)if(!$('spec-'+key).value&&parsed.specs[key])$('spec-'+key).value=parsed.specs[key];
    state.referenceSpecs=getSpecs();
  }catch(error){if(cancelled)throw error;if(current===state)state.referenceContext={message:'原商品信息无法自动读取：'+error.message};}
  render();await save();
}
function requestAutoCompare(){
  if(autoPaused||!state.referenceImage||!state.items.some(item=>['unreviewed','pending'].includes(item.status)&&item.autoAttempt!==state.matchRevision))return;
  autoPending=true;drainAutoCompare();
}
function drainAutoCompare(){
  if(!autoPending||autoPaused||busy||providerReading||selectionProcessing||queuedSelection||autoTimer)return;
  autoTimer=setTimeout(()=>{
    autoTimer=null;if(busy||providerReading||selectionProcessing||queuedSelection)return;
    if(!autoPending||autoPaused)return;
    autoPending=false;run(()=>compareItems({automatic:true}));
  },0);
}
function stopProviderWatch(){if(providerTimer){clearInterval(providerTimer);providerTimer=null;}$('stop-provider').hidden=true;}
function watchProvider(){
  stopProviderWatch();if(!state.providerJob||state.providerJob.manualUpload)return;
  const until=Date.now()+120000;
  $('stop-provider').hidden=false;
  providerTimer=setInterval(()=>{
    if(Date.now()>until){stopProviderWatch();$('provider-status').textContent='自动同步已暂停。图搜加载完成后点击“读取 / 继续同步图搜结果”。';return;}
    if(!providerReading)readProvider(false,{priceOnly:busy}).catch(error=>{$('provider-status').textContent=error.message;});
  },2000);
}
async function startProvider(){
  stopProviderWatch();
  const current=state;
  const selection=state.selection||{};
  const imageUrl=officialImage(selection.imageUrl||state.referenceImage);
  const url=providerSearchURL({...selection,imageUrl});
  const tab=await chrome.tabs.create({url,active:true,windowId});
  if(state!==current)return;
  state.providerJob={tabId:tab.id,selectionId:selection.id||'upload-'+Date.now(),expectedImageUrl:imageUrl,manualUpload:!imageUrl,startedAt:new Date().toISOString(),lastFingerprint:''};
  $('provider-status').textContent=imageUrl?'已提交网页图片，正在等待图搜页面结果。需要登录或验证时请在该页面完成。':'请在打开的图搜页上传同一张本地图片，结果出现后点击“读取 / 继续同步图搜结果”。';
  await save();watchProvider();
}
function mergeProvider(page){
  for(const product of page.products){
    const existing=state.items.find(item=>item.id===product.id&&item.salesSource==='provider-visible');
    if(existing){
      const unchanged=existing.imageUrl===product.imageUrl&&(existing.providerTitle||existing.title)===product.title&&existing.rawText===product.rawText;
      const retained=unchanged?{status:existing.status,matchSource:existing.matchSource,evidence:existing.evidence,missing:existing.missing,differences:existing.differences,detailsText:existing.detailsText,variantAmbiguous:existing.variantAmbiguous,title:existing.title,priceText:existing.priceText,price:existing.price,priceObservations:existing.priceObservations,productKeywords:[...(existing.productKeywords||[]),...(product.productKeywords||[])]}:{};
      // Late-rendered prices refresh independently of image confirmation.
      const previousPrice=existing.price;
      Object.assign(existing,product,retained);
      if(product.priceText&&product.price?.kind!=='unknown'){
        if(previousPrice?.raw&&previousPrice.raw!==product.price.raw)existing.priceObservations=[...(existing.priceObservations||[]),previousPrice].slice(-12);
        existing.priceText=product.priceText;existing.price=product.price;
      }else if(previousPrice?.raw){existing.priceText=previousPrice.raw;existing.price=previousPrice;}
      existing.providerTitle=product.title;if(!unchanged){delete existing.autoAttempt;delete existing.pageImagePriority;}
    }else state.items.push({...product,providerTitle:product.title});
  }
  // Unassociated page-wide words cannot be attributed to any best-selling product.
  if(!state.pages.some(item=>item.url===page.pageUrl))state.pages.push({url:page.pageUrl,capturedAt:page.capturedAt,source:'provider-visible',query:'图片检索'});
  state.lastRun=new Date().toISOString();render();
}
async function readProvider(manual=false,{priceOnly=false}={}){
  if(providerReading)return;
  const job=state.providerJob;
  if(!job)throw new Error('请先点击“打开选品助手图搜”');
  if(job.manualUpload&&!manual)return;
  providerReading=true;
  try{
    const response=await chrome.runtime.sendMessage({type:'collect-provider',tabId:job.tabId});
    if(job!==state.providerJob)return;
    if(!response?.ok){
      if(response?.error?.includes('图搜标签页已关闭')){stopProviderWatch();state.providerJob=null;await save();}
      throw new Error(response?.error||'图搜页面读取失败');
    }
    const page=response.data;
    if(job.expectedImageUrl&&page.state==='results'&&page.queryImageUrl!==job.expectedImageUrl){stopProviderWatch();throw new Error('当前图搜页的图片与本次选图不一致，请重新点击“打开选品助手图搜”。');}
    if(page.state==='challenge'||page.state==='unsupported'){stopProviderWatch();$('provider-status').textContent=page.message;return;}
    if(page.state!=='results'){$('provider-status').textContent=page.message;if(manual)watchProvider();return;}
    const prefs=(await chrome.storage.local.get('preferences')).preferences||{};
    if(job!==state.providerJob)return;
    const data=normalizeProviderPage(page,prefs.providerPeriod||'unknown');
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
    const fingerprint=JSON.stringify([data.products.map(item=>[item.id,item.imageUrl,item.title,item.rawText,item.priceText,item.price?.currency,item.sales,item.market,item.productKeywords]),data.keywords.map(item=>[item.query,item.metrics])]);
    if(fingerprint!==job.lastFingerprint){job.lastFingerprint=fingerprint;mergeProvider(data);await save();}
    $('provider-status').textContent='本页已读取 '+data.products.length+' 个候选商品。工具自动核对后，按销量筛选前 3 款并收集商品关键词。';
    if(manual){
      if(page.queryImageUrl){job.expectedImageUrl=page.queryImageUrl;job.manualUpload=false;watchProvider();}
      else{job.manualUpload=true;stopProviderWatch();$('provider-status').textContent+=' 页面未提供本次图片关联，后续结果需手动读取。';}
      await save();
    }
  }finally{providerReading=false;requestAutoCompare();}
}
async function acceptSelection(value){
  if(value.windowId!==windowId||state.selection?.id===value.id)return;
  queuedSelection=value;
  if(busy){cancelled=true;for(const controller of requestControllers)controller.abort();return;}
  if(selectionProcessing)return;
  selectionProcessing=true;
  try{while(queuedSelection){
    const selected=queuedSelection;queuedSelection=null;stopProviderWatch();
    autoPending=false;autoPaused=false;
    state={...emptyState(),referenceImage:selected.imageUrl,selection:selected,profile:{name:selected.title||'网页选中商品',description:'已提取网页商品图片，结果出现后自动核对。'}};
    for(const key of SPEC_KEYS)$('spec-'+key).value='';
    render();status('已选中网页商品图片。正在打开选品助手图搜…');
    const prefs=(await chrome.storage.local.get('preferences')).preferences||{};
    if(queuedSelection)continue;
    if(prefs.onImageClick==='local'){status('图片已提取。可打开图搜，或读取当前 TEMU 页。');await save();}
    else await startProvider();
  }}catch(error){status(error.message,true);}finally{selectionProcessing=false;requestAutoCompare();}
}

async function collectTab(tabId){
  const response=await chrome.runtime.sendMessage({type:'collect',tabId});
  if(!response?.ok)throw new Error(response?.error||'读取页面失败');
  if(response.data.challenge){await chrome.tabs.update(tabId,{active:true});tempTabs.delete(tabId);throw new Error('TEMU 出现安全验证，请在该页面自行完成验证，再点“读取当前 TEMU 页”');}
  return response.data;
}
function mergePage(page,query=''){
  const incoming=page.detail&&new URL(page.pageUrl).searchParams.has('goods_id')?[page.detail]:page.products;
  if(page.detail&&/-g-\d+\.html/.test(new URL(page.pageUrl).pathname))incoming.splice(0,incoming.length,page.detail);
  for(const product of incoming){
    const existing=state.items.find(item=>item.id===product.id&&(item.salesSource||'temu-visible')==='temu-visible');
    if(existing){existing.queries=[...new Set([...(existing.queries||[]),...(query?[query]:[])])];continue;}
    state.items.push({...product,price:priceObservation(product.priceText,{market:product.market,currency:product.priceCurrency,source:product.priceSource||'visible-page',sourceUrl:page.pageUrl,capturedAt:product.capturedAt}),sales:parseSales(product.rawText),queries:query?[query]:[],status:'unreviewed',missing:[],evidence:[],matchSource:null});
  }
  if(!state.pages.some(item=>item.url===page.pageUrl))state.pages.push({url:page.pageUrl,capturedAt:page.capturedAt,query});
  state.lastRun=new Date().toISOString();render();
  return incoming.length;
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
async function loadSearchPage(url){
  const target=new URL(url);
  if(target.origin!=='https://www.temu.com'||target.pathname!=='/search_result.html')throw new Error('此入口仅支持手动关键词搜索页');
  const tab=await chrome.tabs.create({url,active:false});tempTabs.add(tab.id);
  try{
    await waitForTab(tab.id);
    for(let attempt=0;attempt<5;attempt++){
      const page=await collectTab(tab.id);
      if(page.products.length||page.detail?.images.length)return page;
      await new Promise(resolve=>setTimeout(resolve,600));
    }
    await chrome.tabs.update(tab.id,{active:true});tempTabs.delete(tab.id);
    throw new Error('页面未展示可读取商品。请确认 TEMU 已选择美国站，关闭遮挡弹窗或完成登录后再读取当前页。');
  }finally{
    if(tempTabs.has(tab.id)){tempTabs.delete(tab.id);await chrome.tabs.remove(tab.id).catch(()=>{});}
  }
}
async function compareItems({automatic=false}={}){
  await ensureReferenceContext();
  await ensureReferenceImage();
  const prefs=(await chrome.storage.local.get('preferences')).preferences||{};
  const maxCandidates=Math.max(1,Math.min(40,Number(prefs.maxCandidates)||12));
  const pool=state.items.filter(item=>['unreviewed','pending'].includes(item.status)&&(!automatic||item.autoAttempt!==state.matchRevision)).slice(0,Math.min(60,maxCandidates*3));
  let cursor=0,prioritized=0;
  await Promise.all(Array.from({length:Math.min(2,pool.length)},async()=>{
    while(cursor<pool.length){
      checkCancelled();const item=pool[cursor++];
      try{
        let priority=item.pageImagePriority;
        if(priority?.revision!==state.matchRevision||priority?.imageUrl!==item.imageUrl){
          const result=await api('/compare',{phase:'image-priority',referenceImage:state.referenceImage,referenceImageUrl:state.selection?.imageUrl,imageUrl:item.imageUrl});
          priority=item.pageImagePriority={revision:state.matchRevision,imageUrl:item.imageUrl,imageSimilarity:result.comparison.imageSimilarity,samePhoto:result.comparison.samePhoto};
        }
        item.imageSimilarity=priority.imageSimilarity;item.samePhoto=priority.samePhoto;item.priorityScore=item.samePhoto?1:item.imageSimilarity;delete item.subject;delete item.priorityError;
      }catch(error){if(cancelled)throw error;item.priorityError=error.message;item.status='pending';item.autoAttempt=state.matchRevision;item.missing=['图片读取失败：'+error.message];}
      prioritized++;status('图片初筛 '+prioritized+' / '+pool.length+'，准备优先核对外观最接近的商品…');
    }
  }));
  const candidates=pool.filter(item=>!item.priorityError).sort((a,b)=>(b.priorityScore||0)-(a.priorityScore||0)).slice(0,maxCandidates);
  if(!candidates.length){status('本批商品图片无法读取，已记录原因');if(automatic)requestAutoCompare();return;}
  state.referenceSpecs=getSpecs();
  let processed=0,failures=0;
  let review=[];
  for(const item of candidates){
    checkCancelled();processed++;
    item.autoAttempt=state.matchRevision;
    delete item.subjectAttempt;
    status('页面图片匹配 '+processed+' / '+candidates.length+'：'+item.title.slice(0,55));
    try{
      const first=await api('/compare',{phase:'page-match',referenceImage:state.referenceImage,referenceImageUrl:state.selection?.imageUrl,referenceSpecs:state.referenceSpecs,imageUrl:item.imageUrl,candidateText:comparisonText(item)});
      Object.assign(item,first.comparison,{matchSource:'automated'});
      if(item.variantAmbiguous&&item.status==='exact'){item.status='visual-match';item.missing=['多规格商品，具体 SKU / 对应价格未绑定'];}
      // Matching uses only captured card/detail snapshots and image URLs.
      // Missing listing fields never cause navigation to a product page.
      if(state.referenceContext?.variantAmbiguous&&item.status==='exact'){item.status='visual-match';item.missing=['原商品包含多个 SKU，具体规格未绑定'];}
    }catch(error){
      if(cancelled)throw error;
      failures++;item.missing=[...(item.missing||[]),'读取或核对失败：'+error.message];
      if(!isProductMatch(item))item.status='pending';
      if(error.message.includes('安全验证')||error.message.includes('本机识别服务')){render();await save();throw error;}
    }
    if(item.status==='pending'&&!item.priorityError)review.push(item);
    render();await save();
  }
  // Complete all currently loaded candidates through the original page-image
  // path before any slow subject review, including across automatic batches.
  if(state.items.some(item=>['unreviewed','pending'].includes(item.status)&&item.autoAttempt!==state.matchRevision)){
    status('本批页面图片匹配完成，继续处理其余候选；主体核对将在页面图片匹配后进行。');
    requestAutoCompare();return;
  }
  if(automatic)review=state.items.filter(item=>item.status==='pending'&&item.autoAttempt===state.matchRevision&&item.subjectAttempt!==state.matchRevision&&!item.priorityError);
  let reviewed=0;
  for(const item of review){
    checkCancelled();reviewed++;
    item.subjectAttempt=state.matchRevision;
    status('后续图像核对 '+reviewed+' / '+review.length+'：'+item.title.slice(0,55));
    try{
      const result=await api('/compare',{phase:'subject-review',referenceImage:state.referenceImage,referenceImageUrl:state.selection?.imageUrl,referenceTitle:state.selection?.title||state.referenceContext?.title||'',referenceSpecs:state.referenceSpecs,imageUrl:item.imageUrl,candidateImages:item.verifiedImages||[],candidateText:comparisonText(item)});
      Object.assign(item,result.comparison,{matchSource:'automated'});
      if((item.variantAmbiguous||state.referenceContext?.variantAmbiguous)&&item.status==='exact'){item.status='visual-match';item.missing=['多规格商品，具体 SKU / 对应价格未绑定'];}
    }catch(error){
      if(cancelled)throw error;
      failures++;item.missing=[...(item.missing||[]),'后续主体核对失败：'+error.message];
      if(error.message.includes('本机识别服务')){render();await save();throw error;}
    }
    render();await save();
  }
  const exact=state.items.filter(isProductMatch).length;
  status('本批自动核对 '+processed+' 个商品，同款匹配 '+exact+' 个'+(failures?'；'+failures+' 个读取失败，已保留原因':'')+'。价格和标题使用页面原文；未核实规格单独注明。');
  if(automatic)requestAutoCompare();
}
function comparisonText(item){
  const text=item.detailsText||item.rawText||'',specs=listingSpecs(text),quantity=titleQuantity(item.title);
  return quantity&&!specs.specs.quantity&&!specs.conflicts.includes('quantity')?text+'\nQuantity: '+quantity+'\n数量证据：商品标题原文 '+item.title:text;
}
async function search(){
  const queries=state.selectedQueries.slice(0,3);if(!queries.length)throw new Error('请选至少一组英文搜索词');
  state.lastRun=new Date().toISOString();render();
  for(let i=0;i<queries.length;i++){
    checkCancelled();status('检索关键词 '+(i+1)+' / '+queries.length+'：'+queries[i]);
    const url=new URL('https://www.temu.com/search_result.html');url.searchParams.set('search_key',queries[i]);
    const page=await loadSearchPage(url.href);mergePage(page,queries[i]);await save();
  }
  if(!state.items.length)throw new Error('本次未读取到商品，请在 TEMU 搜索页确认页面已正常加载');
  await compareItems();
}
async function run(task){
  if(busy)return;cancelled=false;setBusy(true);
  try{await task();}catch(error){status(error.message,true);}finally{setBusy(false);render();await save();if(queuedSelection){const value=queuedSelection;queuedSelection=null;await acceptSelection(value);}drainAutoCompare();}
}

async function checkHealth(){
  try{
    const response=await fetch(SERVICE+'/health',{signal:AbortSignal.timeout(2500)});const health=await response.json();
    if(!response.ok)throw new Error('服务错误');
    if(!serviceAvailable){serviceAvailable=true;requestAutoCompare();}
    const local=health.engine==='local';
    $('service-status').textContent=local?health.model.message+(health.model.progress!==null?'（'+health.model.progress+'%）':''):'云端视觉服务'+(health.configured?'已配置':'尚未配置密钥');
    $('prepare-model').hidden=!local||['loading','ready'].includes(health.model.state);
    if(local&&health.model.state==='loading'&&!healthTimer)healthTimer=setInterval(checkHealth,5000);
    if((!local||health.model.state!=='loading')&&healthTimer){clearInterval(healthTimer);healthTimer=null;}
  }catch{
    serviceAvailable=false;
    $('service-status').textContent='识别服务未启动 · 先双击“启动服务.cmd”';$('prepare-model').hidden=true;
    if(!healthTimer)healthTimer=setInterval(checkHealth,5000);
  }
}

$('upload').addEventListener('change',()=>run(async()=>{
  const file=$('upload').files?.[0];if(!file)return;
  if(file.size>8_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请使用 8 MB 以下的 PNG、JPG 或 WebP 图片');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
  stopProviderWatch();autoPending=false;autoPaused=false;state={...emptyState(),referenceImage:data,referenceSpecs:getSpecs()};
  render();status('图片已上传，图搜结果出现后工具会自动核对。');
}));
$('replace-image').addEventListener('click',()=>{$('upload').value='';$('upload').click();});
$('analyze').addEventListener('click',()=>run(startProvider));
$('collect').addEventListener('click',()=>run(async()=>{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)throw new Error('当前没有可读取的浏览器页');
  const page=await collectTab(tab.id);const query=new URL(page.pageUrl).searchParams.get('search_key')||'';
  if(query)addKeyword(query);
  const count=mergePage(page,query);
  if(!count)throw new Error('当前页面未展示可读取商品，请打开商品详情或搜索结果页，等待商品图片加载后重试');
  status('已读取当前页面 '+count+' 个真实商品，正在自动比对。');requestAutoCompare();
}));
$('compare-collected').addEventListener('click',()=>{autoPaused=false;run(async()=>{for(const item of state.items)delete item.autoAttempt;await compareItems({automatic:true});});});
$('search-keywords').addEventListener('click',()=>run(search));
$('provider-search').addEventListener('click',()=>run(startProvider));
$('read-provider').addEventListener('click',()=>{if(busy){readProvider(true,{priceOnly:true}).catch(error=>{$('provider-status').textContent=error.message;});return;}autoPaused=false;run(()=>readProvider(true));});
$('stop-provider').addEventListener('click',()=>{stopProviderWatch();$('provider-status').textContent='已暂停自动同步。可点击“读取 / 继续同步图搜结果”恢复。';});
window.addEventListener('pagehide',()=>{stopProviderWatch();autoPaused=true;if(autoTimer)clearTimeout(autoTimer);if(healthTimer)clearInterval(healthTimer);});
$('add-keyword').addEventListener('click',()=>{addKeyword($('manual-keyword').value);$('manual-keyword').value='';renderKeywords();save();});
$('manual-keyword').addEventListener('keydown',event=>{if(event.key==='Enter')$('add-keyword').click();});
$('cancel').addEventListener('click',()=>{cancelled=true;autoPaused=true;autoPending=false;stopProviderWatch();for(const controller of requestControllers)controller.abort();status('正在停止本次检索…');});
$('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
$('result-sort').addEventListener('change',render);
$('prepare-model').addEventListener('click',()=>run(async()=>{await api('/prepare',{});await checkHealth();status('模型正在加载，完成后可以识别图片。');}));
$('export').addEventListener('click',()=>{
  const data={version:'0.2.1',generatedAt:new Date().toISOString(),targetMarket:'us',coverage:'only-loaded-pages',matchingPolicy:state.matchingPolicy,reference:state.profile,referenceContext:state.referenceContext,referenceSpecs:getSpecs(),pages:state.pages,keywords:bestSellerKeywords(state.items),retrievalQueries:keywordMetrics(state.keywords,state.items),products:state.items};
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
  if(saved&&saved.matchingPolicy!==MATCHING_POLICY){state.matchingPolicy=MATCHING_POLICY;for(const item of state.items){item.status='unreviewed';item.matchSource=null;item.evidence=[];item.missing=[];item.differences=[];delete item.subject;delete item.fastMatch;delete item.visualChecks;delete item.checks;delete item.listingDifferences;delete item.packDifference;delete item.priorityScore;delete item.pageImagePriority;delete item.matchStage;delete item.subjectAttempt;delete item.autoAttempt;}}
}catch{}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes[selectionKey]?.newValue)acceptSelection(changes[selectionKey].newValue);});
render();
if(state.providerJob){$('provider-status').textContent='已恢复上次图搜。点击“读取 / 继续同步图搜结果”或等待自动同步。';watchProvider();}
const selected=(await chrome.storage.session.get(selectionKey))[selectionKey];if(selected)await acceptSelection(selected);
await checkHealth();
requestAutoCompare();
