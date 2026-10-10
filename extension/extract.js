(() => {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const visibleText=node=>clean(node?.innerText||node?.textContent||'');
  const blockedText=visibleText(document.body).slice(0,9000);
  const challenge=/\/bgn_verification\.html/.test(location.pathname)||/verify (?:that )?you are human|security verification|complete the captcha|drag the slider|安全验证|请完成.*验证|访问过于频繁/i.test(blockedText);
  const market=/USD|US\s*\$|United States/i.test(blockedText)?'us':'unverified';
  const result={pageUrl:location.href,market,documentLanguage:document.documentElement.lang||'',capturedAt:new Date().toISOString(),title:document.title,challenge,products:[],detail:null};
  if(challenge)return result;
  function identity(value){
    try{
      const url=new URL(value,location.href);
      if(url.hostname!=='www.temu.com'||url.protocol!=='https:')return null;
      const id=url.searchParams.get('goods_id')||url.pathname.match(/-g-(\d+)\.html$/)?.[1];
      return id&&/^\d{6,25}$/.test(id)?{id,url:'https://www.temu.com/goods.html?goods_id='+id}:null;
    }catch{return null;}
  }
  function imageURL(img){
    const raw=img?.currentSrc||img?.getAttribute('src')||img?.getAttribute('data-src');
    try{
      const url=new URL(raw,location.href);
      return url.protocol==='https:'&&(url.hostname.endsWith('.kwcdn.com')||url.hostname.endsWith('.temu.com'))?url.href:null;
    }catch{return null;}
  }
  function imageList(node){
    return [...new Set([...node.querySelectorAll('img')].filter(img=>!img.hasAttribute('aria-hidden')&&(!img.width||img.width>=48)&&!/^temu$/i.test(clean(img.alt))).sort((a,b)=>(b.width*b.height||0)-(a.width*a.height||0)).map(imageURL).filter(Boolean))].slice(0,6);
  }
  function priceFrom(node,offers){
    const dedicated=[...node.querySelectorAll('[data-current-price],[itemprop="price"],.current-price,.sale-price')].filter(item=>!item.closest('s,del,strike,[hidden],[aria-hidden="true"]'));
    const leaves=[...node.querySelectorAll('*')].filter(item=>!item.children.length&&!item.closest('s,del,strike,[data-original-price],[hidden],[aria-hidden="true"]'));
    for(const item of [...dedicated,...leaves]){
      if(/coupon|discount|saving|original|list-price/i.test(String(item.className)+' '+String(item.parentElement?.className)))continue;
      const value=clean(item.getAttribute('data-current-price')||item.getAttribute('content')||visibleText(item));
      if(/^(?:(?:estimated|from|预估|预计|估计|起价)\s*)?(?:USD\s*|US\$\s*|\$\s*)\d[\d,.]*(?:\s*[-–~]\s*\$?\s*\d[\d,.]*)?$/i.test(value)){
        const context=clean(item.parentElement?.textContent);
        const qualifier=context.length<=250?context.match(/预估|预计|估计|estimated|after coupon|券后|会员价|member price/i)?.[0]:'';
        return {priceText:qualifier&&!value.includes(qualifier)?qualifier+' '+value:value,priceSource:'visible-price'};
      }
    }
    const list=Array.isArray(offers)?offers:offers?[offers]:[];
    if(list.length===1){const offer=list[0],currency=String(offer.priceCurrency||'');
      if(offer.lowPrice!==undefined&&offer.highPrice!==undefined)return {priceText:currency+' '+offer.lowPrice+' – '+currency+' '+offer.highPrice,priceCurrency:currency,priceSource:'structured-offer'};
      if(offer.price!==undefined)return {priceText:currency+' '+offer.price,priceCurrency:currency,priceSource:'structured-offer'};
    }
    return {priceText:'',priceSource:'unavailable'};
  }
  function cardFor(anchor){
    let best=anchor;
    for(let node=anchor,step=0;node&&step<7;node=node.parentElement,step++){
      const text=visibleText(node);
      const ids=new Set([...node.querySelectorAll('a[href]')].map(a=>identity(a.href)?.id).filter(Boolean));
      if(ids.size>1||text.length>2200)break;
      if(node.querySelector('img'))best=node;
      if(text.length>50 && /sold|已售|\$\s*\d|USD/i.test(text))return node;
    }
    return best;
  }
  const seen=new Map();
  function productKeywords(node,id){
    return [...node.querySelectorAll('[data-keyword],.keyword-tag')].filter(tag=>!tag.closest('[hidden],[aria-hidden="true"]')).map(tag=>({query:clean(tag.getAttribute('data-keyword')||visibleText(tag)),productId:id,evidence:visibleText(tag),pageUrl:location.href})).filter(word=>word.query&&word.query.length<=180);
  }
  for(const anchor of document.querySelectorAll('a[href]')){
    const product=identity(anchor.href);
    if(!product)continue;
    const card=cardFor(anchor);const images=imageList(card);
    if(!images.length)continue;
    const text=visibleText(card).slice(0,2200);
    const title=clean(anchor.getAttribute('title')||anchor.getAttribute('aria-label')||anchor.querySelector('img')?.alt||card.querySelector('img')?.alt||visibleText(anchor)).slice(0,2000);
    if(!title)continue;
    const existing=seen.get(product.id);
    if(existing && existing.rawText.length>=text.length)continue;
    seen.set(product.id,{...product,title,images,imageUrl:images[0],productKeywords:productKeywords(card,product.id),rawText:text,sourceUrl:location.href,capturedAt:result.capturedAt,market,...priceFrom(card),source:'visible-page'});
  }
  result.products=[...seen.values()].slice(0,120);
  const declared=typeof globalThis.temuDeclaredProducts==='function'?globalThis.temuDeclaredProducts():new Map();
  for(const product of result.products){const data=declared.get(product.id);if(data){product.listingFields=data.fields;product.verifiedImages=data.images;product.declaredImageSource=data.source;}}
  const current=identity(location.href);
  if(current){
    const main=document.querySelector('main')||document.body;
    let text=String(main.innerText||main.textContent||'').slice(0,24000);
    const cut=text.search(/you may also like|recommended for you|猜你喜欢/i);
    if(cut>100)text=text.slice(0,cut);
    const structured=[];
    function collect(value){
      if(!value||typeof value!=='object')return;
      if(Array.isArray(value)){value.forEach(collect);return;}
      if(value['@type']==='Product'||(Array.isArray(value['@type'])&&value['@type'].includes('Product')))structured.push(value);
      if(value['@graph'])collect(value['@graph']);
    }
    for(const script of document.querySelectorAll('script[type="application/ld+json"]')){try{collect(JSON.parse(script.textContent));}catch{}}
    const headingName=clean(document.querySelector('h1')?.textContent);
    const unbound=structured.filter(item=>!item.url),named=unbound.filter(item=>headingName&&clean(item.name)===headingName);
    const primary=structured.find(item=>item.url&&identity(item.url)?.id===current.id)||(named.length===1?named[0]:undefined)||(unbound.length===1&&!unbound[0].name?unbound[0]:undefined);
    const structuredSpecs={};
    const direct={brand:typeof primary?.brand==='string'?primary.brand:primary?.brand?.name,model:primary?.model,material:primary?.material,dimensions:primary?.size,quantity:primary?.numberOfItems};
    const properties=Array.isArray(primary?.additionalProperty)?primary.additionalProperty:[];
    const aliases={brand:/^(brand|品牌)$/i,model:/^(model|型号)$/i,material:/^(material|材质)$/i,dimensions:/^(dimensions|size|capacity|尺寸|容量)$/i,quantity:/^(quantity|number of pieces|pack quantity|数量|套装数量)$/i};
    for(const [key,pattern]of Object.entries(aliases)){
      const values=[direct[key],...properties.filter(item=>pattern.test(clean(item?.name))).map(item=>item.value)].filter(value=>typeof value==='string'||typeof value==='number').map(value=>clean(value)).filter(Boolean);
      if(new Set(values.map(value=>value.toLowerCase())).size===1)structuredSpecs[key]=values[0];
    }
    // A pack count explicitly written in the product title is listing evidence,
    // unlike counting objects in a marketing photo.
    const titleCounts=[...clean(primary?.name||headingName).matchAll(/(?:^|\b)(\d{1,3})\s*(pairs?|pcs?|pieces?|双|件|个)(?=\b|[\u3400-\u9fff]|$)/gi)].map(match=>clean(match[1]+' '+match[2]));
    if(!structuredSpecs.quantity&&new Set(titleCounts.map(value=>value.toLowerCase())).size===1)structuredSpecs.quantity=titleCounts[0];
    const specLabels={brand:'Brand',model:'Model',material:'Material',dimensions:'Dimensions',quantity:'Quantity'};
    const specText=Object.entries(structuredSpecs).map(([key,value])=>specLabels[key]+': '+value).join('\n');
    const structuredText=primary?JSON.stringify({name:primary.name,brand:primary.brand,model:primary.model,sku:primary.sku,additionalProperty:primary.additionalProperty,description:primary.description}).slice(0,10000):'';
    const declaredImages=Array.isArray(primary?.image)?primary.image:primary?.image?[primary.image]:[];
    const verifiedImages=declaredImages.map(value=>typeof value==='string'?value:value?.url).map(value=>{try{const url=new URL(value,location.href);return url.protocol==='https:'&&url.hostname.endsWith('.kwcdn.com')?url.href:null;}catch{return null;}}).filter(Boolean).slice(0,6);
    const images=verifiedImages.length?verifiedImages:imageList(main);
    const title=clean(document.querySelector('h1')?.textContent||primary?.name||document.title).slice(0,2000);
    const variantAmbiguous=Boolean(primary?.hasVariant)||document.querySelectorAll('[role="radio"],[data-sku-id]').length>1;
    const words=typeof primary?.keywords==='string'?primary.keywords.split(/[,，;；|]+/):Array.isArray(primary?.keywords)?primary.keywords:[];
    const explicitWords=words.filter(word=>typeof word==='string'&&clean(word)&&word.length<=180).map(word=>({query:clean(word),productId:current.id,evidence:JSON.stringify(primary.keywords),pageUrl:location.href}));
    result.detail={...current,title,images,verifiedImages,imageUrl:images[0]||'',productKeywords:explicitWords,structuredSpecs,rawText:text,detailsText:text+(structuredText?'\n结构化商品信息：'+structuredText:'')+(specText?'\n商品结构化规格：\n'+specText:''),variantAmbiguous,sourceUrl:location.href,capturedAt:result.capturedAt,market,source:'visible-detail',...priceFrom(main,primary?.offers)};
    const declaredDetail=declared.get(current.id);if(declaredDetail){result.detail.listingFields=declaredDetail.fields;result.detail.verifiedImages=[...new Set([...verifiedImages,...declaredDetail.images])].slice(0,6);result.detail.declaredImageSource=declaredDetail.imageSource||declaredDetail.source;}
  }
  return result;
})();
