// Public JSON-LD declarations already present in the current document only.
// No app-state evaluation, account data, requests, or protected/premium API data.
globalThis.temuDeclaredProducts=()=>{
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const identity=raw=>{try{const u=new URL(raw,location.href);if(u.protocol!=='https:'||u.hostname!=='www.temu.com')return '';return u.searchParams.get('goods_id')||u.pathname.match(/-g-(\d+)\.html$/)?.[1]||'';}catch{return '';}};
  const declarations=[];let visited=0;
  function walk(value,depth=0){if(!value||typeof value!=='object'||depth>8||declarations.length>=120||++visited>2000)return;if(Array.isArray(value)){value.slice(0,120).forEach(item=>walk(item,depth+1));return;}
    if(value['@type']==='Product'||Array.isArray(value['@type'])&&value['@type'].includes('Product'))declarations.push(value);
    if(value['@graph'])walk(value['@graph'],depth+1);
    if(Array.isArray(value.itemListElement))for(const item of value.itemListElement.slice(0,120))if(item)walk(item.item||item,depth+1);
  }
  for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,12))if(script.textContent.length<=2000000)try{walk(JSON.parse(script.textContent));}catch{}
  const map=new Map(),current=identity(location.href),heading=clean(document.querySelector('h1')?.textContent);
  const unbound=declarations.filter(item=>!item.url&&!item['@id']);
  for(const declaration of declarations){
    let id=identity(declaration.url||declaration['@id']);
    if(!id&&current&&(!declaration.url&&!declaration['@id'])&&unbound.length===1&&heading&&(!declaration.name||clean(declaration.name)===heading))id=current;
    if(!/^\d{6,25}$/.test(id))continue;
    const fields=[];const direct={Brand:typeof declaration.brand==='string'?declaration.brand:declaration.brand?.name,Model:declaration.model,Material:declaration.material,Size:declaration.size,Quantity:declaration.numberOfItems,Color:declaration.color};
    for(const [label,value]of Object.entries(direct))if(['string','number'].includes(typeof value)&&clean(value))fields.push({label,value:clean(value),source:'public-jsonld',productId:id,sourceUrl:location.href});
    for(const property of Array.isArray(declaration.additionalProperty)?declaration.additionalProperty:[])if(property&&['string','number'].includes(typeof property.value)&&/^(?:brand|model|material|size|dimensions|capacity|quantity|number of pieces|color|colour|品牌|型号|材质|尺寸|容量|数量|颜色)$/i.test(clean(property.name)))fields.push({label:clean(property.name),value:clean(property.value),source:'public-jsonld',productId:id,sourceUrl:location.href});
    const declared=Array.isArray(declaration.image)?declaration.image:declaration.image?[declaration.image]:[],images=[];
    for(const image of declared){try{const u=new URL(typeof image==='string'?image:image.url,location.href);if(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&u.hostname.endsWith('.kwcdn.com'))images.push(u.href);}catch{}}
    const previous=map.get(id)||{fields:[],images:[],source:'public-jsonld',productId:id};previous.fields.push(...fields);previous.images=[...new Set([...previous.images,...images])].slice(0,6);map.set(id,previous);
  }
  // Public microdata is another explicit declaration, scoped to its own Product.
  for(const scope of [...document.querySelectorAll('[itemscope][itemtype*="schema.org/Product"]')].slice(0,120)){
    const link=[...scope.querySelectorAll('[itemprop="url"]')].find(node=>node.closest('[itemscope][itemtype*="schema.org/Product"]')===scope),id=identity(scope.getAttribute('itemid')||link?.getAttribute('href')||link?.getAttribute('content'));
    if(!/^\d{6,25}$/.test(id))continue;
    const data=map.get(id)||{fields:[],images:[],source:'public-jsonld',productId:id};
    for(const [key,label]of Object.entries({brand:'Brand',model:'Model',material:'Material',size:'Size',numberOfItems:'Quantity',color:'Color'}))for(const node of scope.querySelectorAll('[itemprop="'+key+'"]')){
      if(node.closest('[itemscope][itemtype*="schema.org/Product"]')!==scope)continue;
      const value=clean(node.getAttribute('content')||node.querySelector('[itemprop="name"]')?.getAttribute('content')||node.querySelector('[itemprop="name"]')?.textContent||node.textContent);
      if(value&&value.length<=200)data.fields.push({label,value,source:'public-microdata',productId:id,sourceUrl:location.href});
    }
    map.set(id,data);
  }
  // A visible gallery is allowed only on the current product detail page. Bind
  // it to the largest image panel; exclude panels containing another goods link.
  if(current&&(heading||globalThis.temuSelectedImageUrl||map.get(current)?.images.length)){
    const visible=node=>!node.closest('[hidden],[aria-hidden="true"]')&&(typeof getComputedStyle!=='function'||getComputedStyle(node).display!=='none');
    const urlOf=img=>{try{const u=new URL(img.currentSrc||img.getAttribute('src')||img.getAttribute('data-src'),location.href);return u.protocol==='https:'&&u.hostname.endsWith('.kwcdn.com')&&!u.username&&!u.password?u.href:'';}catch{return '';}};
    const asset=raw=>{try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '';}};
    const anchors=[globalThis.temuSelectedImageUrl,...(map.get(current)?.images||[])].map(asset).filter(Boolean);
    const images=[...document.querySelectorAll('img')].filter(img=>visible(img)&&urlOf(img)&&anchors.includes(asset(urlOf(img))));
    const hero=images.sort((a,b)=>(b.width||b.clientWidth||0)*(b.height||b.clientHeight||0)-(a.width||a.clientWidth||0)*(a.height||a.clientHeight||0))[0];
    const explicit=[...document.querySelectorAll('[data-product-gallery],[aria-label="Product images"]')];
    let panel=hero?.closest('[data-product-gallery],[aria-label="Product images"]')||(explicit.length===1?explicit[0]:null);
    if(!panel&&hero&&(hero.width||hero.clientWidth||0)>=200)for(let node=hero.parentElement,depth=0;node&&depth<4;node=node.parentElement,depth++){
      if(node===document.body||node.tagName==='MAIN'||node.querySelector('h1'))break;
      const others=[...node.querySelectorAll('a[href]')].map(a=>identity(a.href||a.getAttribute('href'))).filter(Boolean);if(others.some(id=>id!==current))break;
      if(node.querySelectorAll('img').length>=2){panel=node;break;}
    }
    if(panel){
      const owner=panel.closest('[data-product-id]')?.getAttribute('data-product-id');
      const others=[...panel.querySelectorAll('a[href]')].map(a=>identity(a.href||a.getAttribute('href'))).filter(Boolean);
      if((!owner||owner===current)&&!others.some(id=>id!==current)){
        const gallery=[...panel.querySelectorAll('img')].filter(visible).map(urlOf).filter(Boolean);
        if(gallery.length>=2){const data=map.get(current)||{fields:[],images:[],source:'visible-product-gallery',productId:current};data.images=[...new Set([...data.images,...gallery])].slice(0,6);data.imageSource='bound-current-product-gallery';map.set(current,data);}
      }
    }
  }
  return map;
};
void 0;
