export function priceObservation(raw,{market='unverified',sourceUrl='',capturedAt='',source='visible-page',currency:declared=''}={}){
  const text=String(raw||'').replace(/\s+/g,' ').trim();
  const currency=/CAD|CA\s*\$/i.test(text)?'CAD':/AUD|(?:AU|A)\s*\$/i.test(text)?'AUD':/USD|US\$/i.test(text)?'USD':/€|EUR/.test(text)?'EUR':/£|GBP/.test(text)?'GBP':/￥|¥|CNY|RMB/.test(text)?'CNY':['USD','CAD','AUD','EUR','GBP','CNY'].includes(declared)?declared:/\$/.test(text)&&market==='us'?'USD':'';
  const tokens=[...text.matchAll(/(?:(?:USD|CAD|AUD)\s*|(?:US|CA|AU|A)\s*\$\s*|[$€£¥￥]\s*)(\d[\d,]*(?:\.\d{1,2})?)/gi)].map(match=>Number(match[1].replace(/,/g,'')));
  if(!tokens.length&&/^\d[\d,]*(?:\.\d{1,2})?(?:\s*[-–~]\s*\d[\d,]*(?:\.\d{1,2})?)?$/.test(text))tokens.push(...text.split(/\s*[-–~]\s*/).map(value=>Number(value.replace(/,/g,''))));
  const range=text.match(/(?:(?:USD|CAD|AUD)\s*|(?:US|CA|AU|A)\s*\$\s*|[$€£¥￥]\s*)(\d[\d,]*(?:\.\d{1,2})?)\s*(?:[-–~]|\bto\b)\s*(?:(?:USD|CAD|AUD)\s*|(?:US|CA|AU|A)\s*\$\s*|[$€£¥￥]\s*)?(\d[\d,]*(?:\.\d{1,2})?)/i);
  if(range){tokens.length=0;tokens.push(...range.slice(1).map(value=>Number(value.replace(/,/g,''))));}
  const conditional=/coupon|after|estimated|subscribe|member|预估|预计|估计|券|会员|补贴|首次|新用户|折后/i.test(text);
  const starting=/\bfrom\b|起价|起售/i.test(text);
  const kind=!tokens.length?'unknown':conditional?'conditional':starting?'starting':tokens.length===2&&/[-–~]|\bto\b/.test(text)?'range':tokens.length===1?'displayed':'ambiguous';
  return {raw:text,currency,kind,amount:tokens.length===1?tokens[0]:null,low:kind==='range'?Math.min(...tokens):tokens.length===1?tokens[0]:null,high:kind==='range'?Math.max(...tokens):tokens.length===1?tokens[0]:null,skuBound:false,source,sourceUrl,capturedAt};
}
export function priceKindLabel(price){return {range:'页面价格区间',conditional:'页面优惠 / 预估价',starting:'页面起价',displayed:'页面显示价',ambiguous:'多个价格标识，未确定当前价',unknown:'价格未读取'}[price?.kind]||'页面价格标识';}
