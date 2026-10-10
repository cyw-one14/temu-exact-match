import {parseSales,temuProductUrl} from './core.mjs';
import {priceObservation} from './prices.mjs';

export const PROVIDER_ORIGIN='https://www.temaishuju.com';
export function officialImage(raw){
  try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(url.hostname==='kwcdn.com'||url.hostname.endsWith('.kwcdn.com')||url.hostname==='temu.com'||url.hostname.endsWith('.temu.com'))?url.href:'';}catch{return '';}
}
export function providerListingTitle(value){
  const title=String(value||'').replace(/\s+/g,' ').trim();
  return !title||/^(?:temu|TEMU 商品 \d+|image|photo|picture|product(?: image| photo)?|商品图片|产品图片|图片|主图|thumbnail)(?:\s*\d+)?$/i.test(title)||/^(?:temu\s*[|:-]\s*(?:shop|explore)|explore the latest)/i.test(title)?'':title.slice(0,400);
}
export function providerSearchURL(selection={}){
  const url=new URL('/plugin/search-image',PROVIDER_ORIGIN);
  url.searchParams.set('platform','temu');
  if(selection.imageUrl){const image=officialImage(selection.imageUrl);if(!image)throw new Error('请选择 TEMU 商品图片');url.searchParams.set('url',image);url.searchParams.set('from','url');}
  // Region codes belong to the provider. Do not guess a code from a country name.
  if(/^\d{6,25}$/.test(selection.productId||''))url.searchParams.set('goodsId',selection.productId);
  const title=providerListingTitle(selection.title);if(title)url.searchParams.set('title',title);
  return url.href;
}
export function providerSales(fields=[]){
  const options=[];
  for(const field of fields){
    const label=String(field.label||'').trim(),value=String(field.value||'').trim();
    if(!/销量|已售|售出|(?:^|\s)(?:sales|sold)(?:\s|$)/i.test(label)||/销售额|金额|收入|销售率|增[长幅]|趋势|排名|\$|%|revenue|rank|growth/i.test(label+' '+value))continue;
    if(!/^\d[\d,.]*\s*[km万千]?\s*\+?\s*(?:件|笔|units?)?$/i.test(value))continue;
    const count=value.replace(/\s*(?:件|笔|units?)$/i,'');
    const sales=parseSales(count+' sold');
    sales.raw=label+'：'+value;
    sales.period=/\b30\s*(?:天|日|days?)|近\s*30\s*[天日]/i.test(label)?'30d'
      :/\b7\s*(?:天|日|days?)|近\s*7\s*[天日]/i.test(label)?'7d'
      :/24\s*(?:小时|hours?)/i.test(label)?'1d'
      :/总|累计|total|all.?time/i.test(label)?'total'
      :/今日|today/i.test(label)?'today'
      :/\d/.test(label)?'unknown'
      :/月|monthly|month/i.test(label)?'month'
      :/周|weekly|week/i.test(label)?'week'
      :/日|daily/i.test(label)?'day':'unknown';
    sales.periodLabel=label;sales.source='provider-visible';options.push(sales);
  }
  // Use one explicitly labeled window across products; never fall back to a different window.
  return options;
}
export function normalizeProviderPage(page,preferredPeriod='unknown'){
  const capturedAt=page.capturedAt||new Date().toISOString();
  const products=[];
  for(const value of (page.products||[]).slice(0,120)){
    const identity=temuProductUrl(value.url);if(!identity)continue;
    const observations=providerSales(value.salesFields);
    const period=preferredPeriod;
    const sales=observations.find(item=>item.period===period)||{...parseSales(''),period:period||'unknown',periodLabel:period||'',source:'provider-visible'};
    const market=value.market==='us'?'us':'unverified';
    products.push({...value,...identity,productKeywords:(value.productKeywords||[]).map(word=>({...word,capturedAt:word.capturedAt||capturedAt})),title:String(value.title||'TEMU 商品 '+identity.id).slice(0,2000),market,price:priceObservation(value.priceText,{market,currency:value.priceCurrency,source:'provider-visible',sourceUrl:page.pageUrl,capturedAt}),sales,salesObservations:observations,salesSource:'provider-visible',source:'provider-visible',sourceUrl:page.pageUrl,capturedAt,status:'pending',matchSource:null,queries:[],evidence:['来源：特卖数据图搜页面展示的候选'],missing:['尚未完成商品主体自动比对']});
  }
  const keywords=(page.keywords||[]).filter(item=>typeof item.query==='string'&&item.query.trim()).slice(0,50).map(item=>({query:item.query.trim().slice(0,180),source:'provider-visible',label:'第三方页面关键词',metrics:(item.metrics||[]).slice(0,8),pageUrl:page.pageUrl,capturedAt}));
  return {...page,products,keywords,capturedAt};
}
