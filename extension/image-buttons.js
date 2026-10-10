(() => {
  if(globalThis.__temuExactButtons)return;
  globalThis.__temuExactButtons=true;
  let enabled=true,scheduled=false;
  const host=document.createElement('div');host.id='temu-exact-image-buttons';
  host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=':host{all:initial}button{position:absolute;pointer-events:auto;border:1px solid #fff;border-radius:7px;background:#c24a09;color:#fff;font:600 12px/1.3 Arial,"Microsoft YaHei",sans-serif;padding:6px 8px;box-shadow:0 2px 8px #0003;cursor:pointer}button:hover{background:#9d3905}button:focus-visible{outline:2px solid #242629;outline-offset:2px}.message{position:absolute;bottom:20px;left:20px;background:#242629;color:white;padding:12px;border-radius:8px;font:13px Arial;max-width:350px;pointer-events:auto}';shadow.append(style);
  document.documentElement.append(host);
  const buttons=new Map();
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const usableTitle=value=>{const title=clean(value);return title&&!/^(?:temu|(?:temu\s+)?logo|avatar|image|photo|picture|product(?: image| photo)?|商品图片|产品图片|图片|主图|thumbnail)(?:\s*\d+)?$/i.test(title)?title.slice(0,400):'';};
  function imageURL(img){try{const url=new URL(img.currentSrc||img.src||img.getAttribute('data-src'),location.href);return url.protocol==='https:'&&!url.username&&!url.password&&(url.hostname.endsWith('.kwcdn.com')||url.hostname.endsWith('.temu.com'))?url.href:'';}catch{return '';}}
  function identity(raw){try{const url=new URL(raw,location.href);if(url.hostname!=='www.temu.com')return '';const id=url.searchParams.get('goods_id')||url.pathname.match(/-g-(\d+)\.html$/)?.[1];return /^\d{6,25}$/.test(id||'')?id:'';}catch{return '';}}
  function exposed(img){
    if(!img.isConnected||img.closest('[hidden],[aria-hidden="true"]'))return false;
    if(typeof getComputedStyle==='function')for(let node=img;node&&node.nodeType===1;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.opacity!==''&&Number(style.opacity)===0)return false;}
    const rect=img.getBoundingClientRect();
    if(typeof document.elementsFromPoint==='function'){
      const x=(Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2,y=(Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2;
      const stack=document.elementsFromPoint(x,y).filter(node=>node!==host&&!host.contains(node));
      const frontImage=stack.find(node=>node.matches?.('img'));
      if(frontImage&&frontImage!==img)return false;
    }
    return true;
  }
  function scopedTitle(root){
    for(const node of root.querySelectorAll('[data-product-title],[data-tooltip^="goodName-"],[itemprop="name"],h1,h2,h3')){
      if(node.closest('[hidden],[aria-hidden="true"]'))continue;
      const title=usableTitle(node.getAttribute('data-tooltip-title')||node.getAttribute('data-product-title')||node.getAttribute('content')||node.textContent);if(title)return {title,titleSource:'product-title-element'};
    }
    return null;
  }
  function selection(img,declarations=new Map()){
    const imageUrl=imageURL(img);if(!imageUrl||/^(?:temu|(?:temu\s+)?logo|avatar)$/i.test((img.alt||'').trim()))return null;
    let productId='',productIdSource='',root=img.parentElement;
    const current=identity(location.href),anchor=img.closest('a[href]');
    if(anchor&&identity(anchor.href)){productId=identity(anchor.href);productIdSource='enclosing-product-link';root=anchor;}
    const asset=value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return '';}};
    const bound=[...declarations.values()].filter(product=>product.images?.some(value=>asset(value)===asset(imageUrl)));
    if(!productId&&bound.length===1){productId=bound[0].productId;productIdSource='declared-product-image';}
    const main=img.closest('main,[role="main"]')||(current?document.body:null);
    if(!productId&&current&&main){
      const gallery=img.closest('[data-product-gallery],[aria-label="Product images"]');
      const largest=[...main.querySelectorAll('img')].filter(node=>imageURL(node)&&exposed(node)&&!node.closest('a[href]')).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;})[0];
      if(gallery||largest===img){productId=current;productIdSource='current-product-gallery';root=main;}
    }
    for(let node=img,step=0;node&&node!==document.body&&step<6;node=node.parentElement,step++){
      if(productId)break;
      const ids=[...new Set([...node.querySelectorAll('a[href]')].map(a=>identity(a.href)).filter(Boolean))];
      if(ids.length>1)break;if(ids.length===1){productId=ids[0];productIdSource='scoped-product-card';root=node;break;}
    }
    if(!productId)return null;
    const declared=declarations.get(productId);
    let title=usableTitle(declared?.name),titleSource=title?declared.nameSource:'';
    if(!title){const titled=usableTitle(anchor?.getAttribute('title')||anchor?.getAttribute('aria-label'));if(titled){title=titled;titleSource='enclosing-product-link';}}
    if(!title&&anchor)for(let node=anchor,step=0;node&&node!==document.body&&!node.matches('main,[role="main"]')&&step<5;node=node.parentElement,step++){
      const ids=[...new Set([...node.querySelectorAll('a[href]')].map(link=>identity(link.href)).filter(Boolean))];if(ids.some(id=>id!==productId))break;
      const local=scopedTitle(node);if(local){title=local.title;titleSource=local.titleSource;break;}
    }
    if(!title&&root!==main){const local=scopedTitle(root);if(local){title=local.title;titleSource=local.titleSource;}}
    if(!title&&productId===current&&productIdSource!=='scoped-product-card'){
      title=usableTitle(document.querySelector('h1,[role="heading"][aria-level="1"]')?.textContent);titleSource=title?'current-product-heading':'';
      if(!title){title=usableTitle(document.title);if(/^(?:temu\s*[|:-]\s*(?:shop|explore)|explore the latest)/i.test(title))title='';titleSource=title?'current-document-title':'';}
    }
    if(!title){title=usableTitle(img.alt);titleSource=title?'image-alt':'';}
    return {imageUrl,productId,title,titleSource,productIdSource,pageUrl:location.href};
  }
  function notice(message){const note=document.createElement('div');note.className='message';note.setAttribute('role','status');note.textContent=message;shadow.append(note);setTimeout(()=>note.remove(),6000);}
  function refresh(){
    scheduled=false;const keep=new Set();
    const declarations=globalThis.temuDeclaredProducts?.()||new Map();
    if(enabled&&!/bgn_verification/.test(location.pathname))for(const img of document.querySelectorAll('img')){
      if(keep.size>=80)break;
      const rect=img.getBoundingClientRect();
      if(rect.width<90||rect.height<80||rect.bottom<12||rect.top>innerHeight-20||rect.right<12||rect.left>innerWidth-30||!img.getClientRects().length)continue;
      if(!exposed(img))continue;
      const value=selection(img,declarations);if(!value)continue;keep.add(img);
      let button=buttons.get(img);
      if(!button){button=document.createElement('button');button.type='button';button.textContent='查同款';button.title='完全同款助手 · 用这张图片查同款';button.setAttribute('aria-label','查询此商品图片的完全同款');
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(!exposed(img)){schedule();return;}const rect=img.getBoundingClientRect();if((event.clientX||event.clientY)&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)){schedule();return;}const latest=selection(img,globalThis.temuDeclaredProducts?.()||new Map());if(!latest)return;chrome.runtime.sendMessage({type:'image-picked',selection:latest}).then(response=>{if(!response?.ok)notice(response?.error||'无法打开侧栏，请点击工具栏插件图标');}).catch(()=>notice('插件已更新，请刷新 TEMU 页面后重试'));});
        shadow.append(button);buttons.set(img,button);}
      button.style.right=Math.max(6,innerWidth-rect.right+6)+'px';button.style.top=Math.max(4,rect.top+6)+'px';
    }
    for(const [img,button]of buttons)if(!keep.has(img)){button.remove();buttons.delete(img);}
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}}
  new MutationObserver(records=>{if(records.some(record=>!host.contains(record.target)))schedule();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','data-src','hidden','aria-hidden','style','class']});
  addEventListener('scroll',schedule,true);addEventListener('resize',schedule);document.addEventListener('load',schedule,true);
  chrome.storage.local.get('preferences').then(({preferences})=>{enabled=preferences?.imageButtons!==false;schedule();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.preferences){enabled=changes.preferences.newValue?.imageButtons!==false;schedule();}});
  schedule();
})();
