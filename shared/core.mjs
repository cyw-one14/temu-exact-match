export const SPEC_KEYS = ['brand', 'model', 'material', 'dimensions', 'quantity'];
export const SPEC_LABELS = { brand:'品牌', model:'型号', material:'材质', dimensions:'尺寸 / 容量', quantity:'数量 / 套装' };

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
}

export function hasWholeValue(source,value) {
  const escaped=normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(!escaped)return false;
  return new RegExp('(?<![\\p{L}\\p{N}_/+\\-])'+escaped+'(?![\\p{L}\\p{N}_/+\\-])','u').test(normalizeText(source));
}

export function temuProductUrl(value, base = 'https://www.temu.com/') {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.hostname !== 'www.temu.com') return null;
    const id = url.searchParams.get('goods_id') || url.pathname.match(/-g-(\d+)\.html$/)?.[1];
    if (!id || !/^\d{6,25}$/.test(id)) return null;
    return { id, url:'https://www.temu.com/goods.html?goods_id=' + id };
  } catch { return null; }
}

// Preserve ambiguous marketing labels as ranges. Never infer sales from reviews.
export function parseSales(raw) {
  const text = String(raw || '').trim();
  const found = text.match(/(?:sold|已售|售出|已销售)\s*[:：]?\s*(\d[\d,.]*\s*[km万千]?\s*\+?)/i)
    || text.match(/(\d[\d,.]*\s*[km万千]?\s*\+?)\s*(?:sold|已售|售出|已销售)/i);
  if (!found) return { raw:'', lowerBound:null, displayValue:null, exact:false, kind:'unknown', period:'unknown' };
  const token = found[1].replace(/\s/g,'');
  const unit = token.match(/[km万千]/i)?.[0]?.toLowerCase();
  const multiplier = {k:1e3,m:1e6,'万':1e4,'千':1e3}[unit] || 1;
  const displayValue = Number(token.replace(/[,km万千+]/gi,'')) * multiplier;
  // Abbreviations are rounded even without a '+' and do not imply an exact count.
  const exact = !token.includes('+') && !unit;
  const period = /(?:past|last)\s*30\s*days|近\s*30\s*天/i.test(text) ? '30d'
    : /(?:past|last)\s*7\s*days|近\s*7\s*天/i.test(text) ? '7d' : 'unknown';
  const kind=token.includes('+')?'lower-bound':exact?'exact':'approximate';
  return { raw:found[0].trim(), lowerBound:kind==='approximate'?null:(Number.isFinite(displayValue)?displayValue:null), displayValue:Number.isFinite(displayValue)?displayValue:null, exact, kind, period };
}

export function decideExact(comparison, referenceSpecs = {}, candidateText = '') {
  const visual = comparison?.visual;
  if (visual === 'different' || comparison?.differences?.length) {
    return { status:'different', reason:'存在外观或规格差异', missing:[] };
  }
  const checks = Array.isArray(comparison?.checks) ? comparison.checks : [];
  const source = normalizeText(candidateText);
  const missing = [];
  for (const key of SPEC_KEYS) {
    const reference = normalizeText(referenceSpecs[key]);
    const check = checks.find(item => item.key === key);
    if (check?.status === 'different') return { status:'different', reason:SPEC_LABELS[key] + '不同', missing:[] };
    if (!reference) { missing.push('上传产品的' + SPEC_LABELS[key]); continue; }
    if (!check || check.status !== 'same' || !check.candidateValue || !check.evidence) {
      missing.push('站内商品的' + SPEC_LABELS[key]); continue;
    }
    const candidate = normalizeText(check.candidateValue);
    const evidence = normalizeText(check.evidence);
    // A model's 'same' verdict cannot override conflicting or invented values.
    if (candidate !== reference) { missing.push(SPEC_LABELS[key] + '需要逐项核对'); continue; }
    if (!hasWholeValue(source,candidate) || !source.includes(evidence)) {
      missing.push(SPEC_LABELS[key] + '缺少详情原文证据');
    }
  }
  if (!['same_photo','identical'].includes(visual)) missing.unshift('外观细节一致性');
  if (missing.length) return { status:'pending', reason:'信息不足，暂不计入完全同款推荐', missing:[...new Set(missing)] };
  return { status:'exact', reason:'图片 / 外观与已提供规格均核对一致', missing:[] };
}

export function isProductMatch(item){return ['exact','visual-match'].includes(item?.status);}

// Only explicit, unambiguous title counts. Multi-SKU titles remain unknown.
export function titleQuantity(title){
  const matches=[...String(title||'').matchAll(/(?<![\d.])(\d{1,4})\s*[- ]?\s*(pcs?|pieces?|units?|packs?|pairs?)(?![\p{L}\p{N}])/giu)];
  const values=new Set(matches.map(match=>Number(match[1])+' '+(/pair/i.test(match[2])?'pair':'pc')));
  return values.size===1?matches[0][0].trim():'';
}

const QUANTITY_PATTERN=/(?<![\d.])(\d+(?:\.\d+)?)\s*[- ]?\s*(pcs?|pieces?|units?|packs?|pairs?|件|个|双)(?![\p{L}\p{N}])/giu;
const UNIT_PATTERN=/(?<![\d.])(\d+(?:\.\d+)?)\s*(fl oz|inch|mm|cm|ml|kg|oz|l|m|g)(?![a-z0-9])/giu;
const UNIT_FACTORS={l:{kind:'volume',factor:1000},ml:{kind:'volume',factor:1},'fl oz':{kind:'volume',factor:29.5735},oz:{kind:'volume',factor:29.5735},kg:{kind:'weight',factor:1000},g:{kind:'weight',factor:1},m:{kind:'length',factor:1000},cm:{kind:'length',factor:10},mm:{kind:'length',factor:1},inch:{kind:'length',factor:25.4}};

function quantityValues(text){
  const found=new Set();
  for(const match of text.matchAll(QUANTITY_PATTERN))found.add(Number(match[1])+' '+(/^(?:pairs?|双)$/i.test(match[2])?'pair':'pc'));
  return found.size?found:null;
}

function measureValues(text){
  const found=[];
  for(const match of text.replace(/[×*]/g,'x').matchAll(UNIT_PATTERN)){
    const unit=UNIT_FACTORS[match[2].toLowerCase()];
    found.push({kind:unit.kind,base:Number(match[1])*unit.factor});
  }
  return found.length?found:null;
}

function closeNumber(a,b){return Math.abs(a-b)<=Math.max(a,b)*.05;}

// Page wording is the noisiest signal in the pipeline, so only a number that survives
// unit conversion, or a clearly unrelated model code, may prove a different product.
export function specConflict(key,reference,candidate){
  const a=normalizeText(reference),b=normalizeText(candidate);
  if(!a||!b||a===b)return null;
  if(/^\d+(?:\.\d+)?$/.test(a)||/^\d+(?:\.\d+)?$/.test(b))return 'unverified';
  if(key==='quantity'){
    const x=quantityValues(a),y=quantityValues(b);
    if(!x||!y)return 'unverified';
    if(x.size===y.size&&[...x].every(value=>y.has(value)))return null;
    return [...x].some(value=>!y.has(value))?'different':'unverified';
  }
  if(key==='dimensions'){
    const x=measureValues(a),y=measureValues(b);
    if(!x||!y)return 'unverified';
    const kinds=new Set(x.map(item=>item.kind).filter(kind=>y.some(item=>item.kind===kind)));
    if(!kinds.size)return 'unverified';
    const left=x.filter(item=>kinds.has(item.kind)),right=y.filter(item=>kinds.has(item.kind));
    const covers=(from,to)=>from.every(value=>to.some(other=>other.kind===value.kind&&closeNumber(value.base,other.base)));
    if(covers(left,right)&&covers(right,left))return null;
    return left.some(value=>!right.some(other=>other.kind===value.kind&&closeNumber(value.base,other.base)))?'different':'unverified';
  }
  if(key==='model'){
    const x=a.replace(/[^a-z0-9]/g,''),y=b.replace(/[^a-z0-9]/g,'');
    if(!x||!y||x.includes(y)||y.includes(x))return 'unverified';
    return /\d/.test(x)&&/\d/.test(y)?'different':'unverified';
  }
  return 'unverified';
}

export function decideProductMatch(comparison,referenceSpecs={},candidateText=''){
  // Product identity is image-only. Listing specifications are annotations.
  // Unstructured differences can contain listing text, so they never veto it.
  const imageDifferences=(comparison?.visualChecks||[]).filter(check=>['shape','construction','color','pattern','logo','accessories'].includes(check?.key)&&check.status==='different'&&String(check.evidence||'').trim().length>=4).map(check=>String(check.evidence));
  if(comparison?.visual==='different'||imageDifferences.length)return {status:'different',packDifference:null,listingDifferences:[],reason:'图片商品主体存在差异',differences:imageDifferences.length?imageDifferences:comparison?.differences||[],missing:[]};
  const imageComparison={...comparison,differences:[],checks:(comparison?.checks||[]).map(check=>check.status==='different'?{...check,status:'unknown'}:check)};
  const strict=decideExact(imageComparison,referenceSpecs,candidateText);
  const candidate=listingSpecs(candidateText);
  const wording=[];
  const listingDifferences=[];
  let packDifference=null;
  for(const key of SPEC_KEYS){
    if(!referenceSpecs[key]||!candidate.specs[key])continue;
    const conflict=specConflict(key,referenceSpecs[key],candidate.specs[key]);
    if(conflict){
      listingDifferences.push({key,reference:referenceSpecs[key],candidate:candidate.specs[key]});
      wording.push((key==='quantity'?'售卖数量不同':SPEC_LABELS[key]+'页面显示不同')+'（参考 '+referenceSpecs[key]+' / 此链接 '+candidate.specs[key]+'），仅作页面信息提示，不参与同款判断');
    }
    if(conflict==='different'&&key==='quantity'){
      packDifference={reference:referenceSpecs[key],candidate:candidate.specs[key],source:'listing'};
    }
  }
  if(strict.status==='exact'&&!candidate.conflicts.length)return {...strict,differences:[],packDifference:null,listingDifferences,matchTier:'specs-verified'};
  const visualConfirmed=['same_photo','identical'].includes(comparison?.visual)||comparison?.subject?.matched===true||comparison?.fastMatch?.matched===true;
  if(visualConfirmed)return {status:'visual-match',matchTier:'appearance',differences:[],packDifference,listingDifferences,reason:'图片商品主体一致；文字信息只作参考',missing:[...new Set([...strict.missing.filter(value=>value!=='外观细节一致性'),...candidate.conflicts.map(key=>SPEC_LABELS[key]+'存在多个页面值，具体 SKU 未绑定'),...wording])]};
  return {...strict,status:'pending',differences:[],packDifference,listingDifferences,reason:'图片商品主体尚未确认，保留待核对',missing:[...new Set([...strict.missing,...wording])]};
}

export function rankMatches(items){return rankExact(items.filter(isProductMatch).map(item=>({...item,status:'exact',originalStatus:item.status}))).map(item=>({...item,status:item.originalStatus}));}

export function localSpecChecks(referenceSpecs, candidateText) {
  const source = normalizeText(candidateText);
  const conflicts=listingSpecs(candidateText).conflicts;
  return SPEC_KEYS.map(key => {
    const value = String(referenceSpecs?.[key] || '').trim();
    const labels={brand:'brand|品牌',model:'model|型号',material:'material|材质',dimensions:'dimensions|size|capacity|尺寸|容量',quantity:'quantity|number of pieces|pack quantity|数量|套装数量'};
    const escaped=normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const labelled=value && new RegExp('(?:'+labels[key]+')["\\s]*[:：]["\\s]*'+escaped+'(?![\\p{L}\\p{N}_/+\\-])','u').exec(source);
    const found = value && labelled && hasWholeValue(source,value)&&!conflicts.includes(key);
    return { key, status:found?'same':'unknown', candidateValue:found?value:'', evidence:found?labelled[0]:'' };
  });
}

export function listingSpecs(text, structured={}) {
  const labels={brand:'brand|品牌',model:'model|型号',material:'material|材质',dimensions:'dimensions|size|capacity|尺寸|容量',quantity:'quantity|number of pieces|pack quantity|数量|套装数量'};
  const specs={},evidence=[],conflicts=[];
  for(const key of SPEC_KEYS){
    const values=[];
    if(typeof structured[key]==='string'&&structured[key].trim())values.push({value:structured[key].trim(),quote:structured[key].trim(),source:'structured-product'});
    const pattern=new RegExp('(?:^|[;；\\n])\\s*(?:'+labels[key]+')\\s*[:：]\\s*([^;；\\n]{1,100})','gim');
    for(const match of String(text||'').matchAll(pattern))values.push({value:match[1].trim(),quote:match[0].trim(),source:'listing-text'});
    const unique=[...new Set(values.map(item=>normalizeText(item.value)))];
    if(unique.length===1){specs[key]=values[0].value;evidence.push({key,value:values[0].value,evidence:values[0].quote,source:values[0].source});}
    else if(unique.length>1)conflicts.push(key);
  }
  return {specs,evidence,conflicts};
}

export function rankExact(items) {
  const exact = items.filter(item => item.status === 'exact');
  // Different reporting windows or markets are never merged into one sales ranking.
  const cohorts = new Map();
  for (const item of exact) {
    const key = (item.salesSource || 'temu-visible') + ':' + (item.market || 'unknown') + ':' + (item.sales?.period || 'unknown');
    if (!cohorts.has(key)) cohorts.set(key,[]);
    cohorts.get(key).push(item);
  }
  const ordered = [];
  for (const [cohort, group] of cohorts) {
    group.sort((a,b) => (salesDisplayNumber(b.sales) ?? -1) - (salesDisplayNumber(a.sales) ?? -1));
    ordered.push(...group.map(item => ({...item, salesCohort:cohort})));
  }
  return ordered;
}

export function salesDisplayNumber(sales) {
  const value=sales?.lowerBound ?? sales?.displayValue;
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
}

// Keep literal title clauses. No model completion, translation or recombination.
export function titleKeywords(title) {
  const text=String(title||'').replace(/\s+/g,' ').trim();
  if(!text||/^TEMU 商品 \d+$/.test(text))return [];
  return [...new Set(text.split(/[,，;；|\n]+/).map(value=>value.trim()).filter(value=>{
    if(value.length<4||value.length>180)return false;
    return /[\u3400-\u9fff]/.test(value)||value.split(/\s+/).filter(Boolean).length>=2;
  }))].slice(0,3);
}

export function bestSellerKeywords(items, topCount=3) {
  const groups=new Map();
  for(const item of rankMatches(items)){
    if(salesDisplayNumber(item.sales)===null)continue;
    if(!groups.has(item.salesCohort))groups.set(item.salesCohort,[]);
    const group=groups.get(item.salesCohort);
    if(!group.some(value=>value.id===item.id))group.push(item);
  }
  return [...groups].map(([cohort,all])=>{
    const products=all.slice(0,Math.max(1,Math.min(10,topCount))),words=new Map();
    products.forEach((product,index)=>{
      const explicit=(product.productKeywords||[]).filter(word=>word.query&&word.productId===product.id&&word.evidence&&word.pageUrl);
      const candidates=explicit.length?explicit.map(word=>({...word,kind:'product-keyword'})):titleKeywords(product.title).map(query=>({query,kind:'title-phrase',evidence:product.title,pageUrl:product.sourceUrl||product.url}));
      for(const word of candidates){
        const identity=normalizeText(word.query);if(!identity)continue;
        if(!words.has(identity))words.set(identity,{query:word.query,sources:[]});
        const keyword=words.get(identity);
        if(!keyword.sources.some(value=>value.productId===product.id))keyword.sources.push({productId:product.id,url:product.url,title:product.title,matchStatus:product.status,rank:index+1,sales:product.sales,market:product.market,salesSource:product.salesSource||'temu-visible',kind:word.kind,evidence:word.evidence,pageUrl:word.pageUrl,capturedAt:product.capturedAt});
      }
    });
    return {cohort,eligibleProducts:all.length,products,keywords:[...words.values()]};
  });
}

export function keywordMetrics(queries, items) {
  return queries.map(query => {
    const found = items.filter(item => (item.queries || []).includes(query));
    const exactCount = found.filter(item=>item.status==='exact').length;
    const evaluated = found.filter(item=>['exact','pending','different'].includes(item.status)).length;
    return { query, total:found.length, evaluated, exactCount, precision:evaluated?exactCount/evaluated:0 };
  }).sort((a,b)=>b.exactCount-a.exactCount || b.precision-a.precision);
}
