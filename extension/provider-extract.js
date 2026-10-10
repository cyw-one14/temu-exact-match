(() => {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const visible=node=>{
    if(!node||node.closest('[hidden],[aria-hidden="true"]'))return false;
    if(typeof getComputedStyle==='function')for(let parent=node;parent&&parent.nodeType===1;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden')return false;}
    return true;
  };
  const text=node=>visible(node)?clean(node.innerText||node.textContent):'';
  const body=text(document.body).slice(0,20000);
  const result={pageUrl:location.href,capturedAt:new Date().toISOString(),source:'provider-visible',products:[],keywords:[],state:'waiting',message:''};
  if(/captcha|verify you are human|安全验证|人机验证|访问过于频繁|access denied|forbidden|403 forbidden/i.test(body)){result.state='challenge';result.message='图搜页面需要完成验证或当前访问不可用';return result;}
  const current=new URL(location.href);
  if(current.pathname!=='/plugin/search-image'){result.state=/login|sign.?in/.test(current.pathname)?'login':'unsupported';result.message='请在特卖数据图搜页面完成登录并返回图片查询';return result;}
  result.queryImageUrl=current.searchParams.get('url')||'';
  const selectedPlatforms=[...document.querySelectorAll('[role="tab"][aria-selected="true"],.ant-tabs-tab-active')].filter(visible).map(text).filter(value=>/^(?:Temu|1688.*|拼多多.*|淘宝|Shein|Shopee|Tiktok|亚马逊|Ozon|美客多|速卖通|Alibaba国际站)$/i.test(value));
  if(selectedPlatforms.length&&!selectedPlatforms.some(value=>/^Temu$/i.test(value))){result.state='unsupported';result.message='请在图搜页面选择 Temu 标签，再继续同步';return result;}
  function identity(raw){
    try{const url=new URL(raw,location.href);let id;
      if(url.protocol!=='https:')return null;
      if(url.hostname==='www.temu.com')id=url.searchParams.get('goods_id')||url.pathname.match(/-g-(\d+)\.html$/)?.[1];
      else if(url.origin===current.origin&&/(?:goods|product)(?:[/-]|$)/.test(url.pathname))id=url.searchParams.get('goodsId')||url.searchParams.get('goods_id');
      return /^\d{6,25}$/.test(id||'')?{id,url:'https://www.temu.com/goods.html?goods_id='+id}:null;
    }catch{return null;}
  }
  function imageURL(node){
    for(const img of node.querySelectorAll('img')){
      if(!visible(img))continue;
      try{const url=new URL(img.currentSrc||img.getAttribute('src')||img.getAttribute('data-src'),location.href);if(url.protocol==='https:'&&!url.username&&!url.password&&!/logo|icon|avatar/i.test(url.pathname))return url.href;}catch{}
    }return '';
  }
  function cardFor(anchor){
    const row=anchor.closest('tr,[role="row"]');if(row)return row;
    const known=anchor.closest('a.list-item');if(known)return known;
    let best=anchor;
    for(let node=anchor,step=0;node&&node!==document.body&&step<7;node=node.parentElement,step++){
      const ids=new Set([...node.querySelectorAll('a[href]')].map(a=>identity(a.href||a.getAttribute('href'))?.id).filter(Boolean));
      if(ids.size>1||text(node).length>3500)break;
      if(node.querySelector('img'))best=node;
      if(/销量|sold|sales/i.test(text(node)))return node;
    }return best;
  }
  function tableFields(row){
    const table=row.closest('table,[role="table"],[role="grid"]');if(!table)return [];
    const headers=[...table.querySelectorAll('thead th,[role="columnheader"]')].filter(visible).map(text);
    const cells=[...row.querySelectorAll(':scope > td,:scope > [role="cell"],:scope > [role="gridcell"]')].filter(visible);
    return cells.map((cell,index)=>({label:headers[index]||'',value:text(cell)})).filter(field=>field.label);
  }
  function labelledFields(node){
    const content=node.innerText||node.textContent||'';
    return [...content.matchAll(/((?:(?:近|最近|过去)?\s*\d+\s*[天日周月]|日|周|月|总|累计|今日)?销量|(?:daily|weekly|monthly|total)\s+sales|已售出|已售|售出|已销售|sold)\s*[:：]?\s*(\d[\d,.]*\s*[km万千]?\s*\+?)/gi)].map(match=>({label:clean(match[1]),value:clean(match[2])}));
  }
  function productKeywords(node,fields,productId){
    const identities=new Set([...node.querySelectorAll('a[href]')].map(anchor=>identity(anchor.href||anchor.getAttribute('href'))?.id).filter(Boolean));
    if(identities.size>1)return [];
    const words=[];
    function add(query,evidence){query=clean(query);if(query&&query.length<=180)words.push({query,productId,evidence:clean(evidence),pageUrl:location.href});}
    for(const field of fields.filter(field=>/^(?:商品关键词|关键词|搜索关键词|搜索词|keywords?|search terms?)$/i.test(field.label)))for(const query of field.value.split(/[,，;；|\n]+/))add(query,field.label+'：'+field.value);
    for(const tag of node.querySelectorAll('[data-keyword],.keyword-tag'))if(visible(tag))add(tag.getAttribute('data-keyword')||text(tag),text(tag));
    return words;
  }
  function visiblePrice(card,fields){
    const field=fields.find(item=>/售价|价格|price/i.test(item.label)&&!/供货|cost|原价|original/i.test(item.label));
    if(field)return {priceText:(/预估|券|estimated|coupon/i.test(field.label)?field.label+' ':'')+(/USD/i.test(field.label)&&!/[\$]|USD/i.test(field.value)?'USD ':'')+field.value,priceCurrency:/USD/i.test(field.label)?'USD':''};
    const excluded='s,del,strike,[data-original-price],.original-price,.old-price,.price-old,.list-price,.coupon,.discount,.saving,.sold,.sales,[hidden],[aria-hidden="true"]';
    const format=/^(?:(?:from|estimated|预估|预计|起价|券后|会员价)\s*)?(?:USD\s*|US\$\s*|[$€£¥￥]\s*)\d[\d,]*(?:\.\d{1,2})?(?:\s*[-–~]\s*(?:USD\s*|US\$\s*|[$€£¥￥]\s*)?\d[\d,]*(?:\.\d{1,2})?)?$/i;
    const roots=[...card.querySelectorAll('[data-current-price],[itemprop="price"],.current-price,.sale-price,.goods-price,.price,.price-wrap')].filter(visible);
    const leaves=[...card.querySelectorAll('*')].filter(node=>!node.children.length&&visible(node));
    for(const root of [...roots,...leaves]){
      if(root.closest(excluded)||/coupon|discount|saving|original|old-price|price-old|list-price/i.test(String(root.className)+' '+String(root.parentElement?.className)))continue;
      const copy=root.cloneNode(true);
      const originalChildren=[...root.querySelectorAll('*')],copiedChildren=[...copy.querySelectorAll('*')];
      copiedChildren.forEach((child,index)=>{if(!visible(originalChildren[index]))child.remove();});
      for(const child of copy.querySelectorAll(excluded))child.remove();
      const value=clean(root.getAttribute('data-current-price')||root.getAttribute('content')||copy.textContent).replace(/(\d)\s*\.\s*(\d)/g,'$1.$2').replace(/^([$€£¥￥])(?:\s*\1)+\s*(?=\d)/,'$1');
      const currency=root.getAttribute('data-currency')||'';
      // Dedicated price containers may display the currency through CSS/icons.
      // Preserve their numeric amount, with currency unknown if not explicit.
      if(!format.test(value)&&!(/^\d[\d,]*(?:\.\d{1,2})?(?:\s*[-–~]\s*\d[\d,]*(?:\.\d{1,2})?)?$/.test(value)&&roots.includes(root)))continue;
      const context=text(root.parentElement),qualifier=context.length<=250?context.match(/预估|预计|estimated|after coupon|券后|会员价|member price/i)?.[0]:'';
      if(context.length<=250&&/coupon|saving|discount|优惠券|节省/i.test(context)&&!qualifier)continue;
      return {priceText:(qualifier&&!value.includes(qualifier)?qualifier+' ':'')+value,priceCurrency:currency};
    }
    return {priceText:'',priceCurrency:''};
  }
  const selectedRegion=[...document.querySelectorAll('select option:checked,[data-selected-region],.selected-region')].filter(visible).map(text).join(' ');
  const pageMarket=/美国|United States|^US$/i.test(selectedRegion)||/(?:当前站点|国家|站点|market|country)\s*[:：]\s*(?:美国|United States|US\b)/i.test(body)?'us':'unverified';
  const seen=new Map();
  const declared=typeof globalThis.temuDeclaredProducts==='function'?globalThis.temuDeclaredProducts():new Map();
  for(const anchor of document.querySelectorAll('a[href]')){
    if(!visible(anchor))continue;
    const product=identity(anchor.href||anchor.getAttribute('href'));if(!product)continue;
    const card=cardFor(anchor),imageUrl=imageURL(card);if(!imageUrl)continue;
    const fields=tableFields(card),rawText=text(card).slice(0,3500);
    const titleField=fields.find(field=>/商品名称|商品信息|产品名称|product|title/i.test(field.label));
    const title=clean(card.querySelector('.title')?.textContent||anchor.getAttribute('title')||anchor.getAttribute('aria-label')||titleField?.value||anchor.querySelector('img')?.alt||card.querySelector('h2,h3,h4')?.textContent||text(anchor)||card.querySelector('img')?.alt).slice(0,2000);
    const salesFields=[...fields.filter(field=>/销量|sales|sold/i.test(field.label)),...labelledFields(card)];
    const market=fields.some(field=>/国家|站点|market|country/i.test(field.label)&&/美国|United States|^US$/i.test(field.value))?'us':pageMarket;
    const data=declared.get(product.id);
    const value={...product,title,imageUrl,images:[imageUrl],rawText,listingFields:[...fields,...(data?.fields||[])],verifiedImages:data?.images||[],declaredImageSource:data?.source||'',productKeywords:productKeywords(card,fields,product.id),...visiblePrice(card,fields),salesFields,market};
    const previous=seen.get(product.id);if(!previous||salesFields.length>previous.salesFields.length)seen.set(product.id,value);
  }
  result.products=[...seen.values()].slice(0,120);
  const words=new Map();
  for(const table of document.querySelectorAll('table,[role="table"],[role="grid"]')){
    for(const row of table.querySelectorAll('tbody tr,[role="row"]')){
      if(!visible(row))continue;
      const fields=tableFields(row),word=fields.find(field=>/^(?:关键词|搜索词|搜索关键词|keyword|search term)s?$/i.test(field.label));
      if(word?.value&&word.value.length<=180){
        words.set(word.value,{query:word.value,metrics:fields.filter(field=>field!==word&&!/商品|图片|链接/.test(field.label)).slice(0,8)});
        const ids=[...new Set([...row.querySelectorAll('a[href]')].map(anchor=>identity(anchor.href||anchor.getAttribute('href'))?.id).filter(Boolean))];
        if(ids.length===1&&seen.has(ids[0]))seen.get(ids[0]).productKeywords.push(...productKeywords(row,fields,ids[0]));
      }
    }
  }
  for(const heading of document.querySelectorAll('h2,h3,h4,[data-keyword-heading]')){
    if(!visible(heading)||!/(?:推荐|搜索|热卖)?关键词|搜索词|recommended keywords/i.test(text(heading)))continue;
    const section=heading.closest('section')||heading.parentElement;
    for(const candidate of section.querySelectorAll('[data-keyword],.keyword,.keyword-tag,.el-tag,.ant-tag')){
      const query=clean(candidate.getAttribute('data-keyword')||text(candidate));
      if(query&&query.length<=180&&!/关键词|搜索词/.test(query))words.set(query,{query,metrics:[]});
    }
  }
  result.keywords=[...words.values()].slice(0,50);
  result.state=result.products.length||result.keywords.length?'results':/暂无数据|没有找到|无搜索结果|no results/i.test(body)?'empty':/请先登录|登录后|sign in to|login required/i.test(body)?'login':'waiting';
  result.message=result.state==='results'?'已读取图搜页面展示结果':result.state==='empty'?'图搜页面未找到结果':result.state==='login'?'请在图搜页面完成正常登录':'等待图搜结果；请确认原助手已启用，并在图搜页选择美国站';
  return result;
})();
