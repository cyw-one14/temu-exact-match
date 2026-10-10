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
  function imageURL(img){try{const url=new URL(img.currentSrc||img.src||img.getAttribute('data-src'),location.href);return url.protocol==='https:'&&!url.username&&!url.password&&(url.hostname.endsWith('.kwcdn.com')||url.hostname.endsWith('.temu.com'))?url.href:'';}catch{return '';}}
  function identity(raw){try{const url=new URL(raw,location.href);if(url.hostname!=='www.temu.com')return '';const id=url.searchParams.get('goods_id')||url.pathname.match(/-g-(\d+)\.html$/)?.[1];return /^\d{6,25}$/.test(id||'')?id:'';}catch{return '';}}
  function selection(img){
    const imageUrl=imageURL(img);if(!imageUrl||/^(?:temu|(?:temu\s+)?logo|avatar)$/i.test((img.alt||'').trim()))return null;
    let productId='',title=img.alt||'';
    for(let node=img,step=0;node&&node!==document.body&&step<6;node=node.parentElement,step++){
      if(node.matches('a[href]')){productId=identity(node.href);if(productId){title=node.getAttribute('title')||node.getAttribute('aria-label')||title;break;}}
      const ids=[...new Set([...node.querySelectorAll('a[href]')].map(a=>identity(a.href)).filter(Boolean))];
      if(ids.length>1)break;if(ids.length===1){productId=ids[0];break;}
    }
    if(!productId){productId=identity(location.href);if(!productId||!img.closest('main,[role="main"]'))return null;title=title||document.querySelector('h1')?.textContent||'';}
    return {imageUrl,productId,title:String(title).trim().slice(0,400),pageUrl:location.href};
  }
  function notice(message){const note=document.createElement('div');note.className='message';note.setAttribute('role','status');note.textContent=message;shadow.append(note);setTimeout(()=>note.remove(),6000);}
  function refresh(){
    scheduled=false;const keep=new Set();
    if(enabled&&!/bgn_verification/.test(location.pathname))for(const img of document.querySelectorAll('img')){
      if(keep.size>=80)break;
      const rect=img.getBoundingClientRect();
      if(rect.width<90||rect.height<80||rect.bottom<12||rect.top>innerHeight-20||rect.right<12||rect.left>innerWidth-30||!img.getClientRects().length)continue;
      const value=selection(img);if(!value)continue;keep.add(img);
      let button=buttons.get(img);
      if(!button){button=document.createElement('button');button.type='button';button.textContent='查同款';button.title='完全同款助手 · 用这张图片查同款';button.setAttribute('aria-label','查询此商品图片的完全同款');
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const latest=selection(img);if(!latest)return;chrome.runtime.sendMessage({type:'image-picked',selection:latest}).then(response=>{if(!response?.ok)notice(response?.error||'无法打开侧栏，请点击工具栏插件图标');}).catch(()=>notice('插件已更新，请刷新 TEMU 页面后重试'));});
        shadow.append(button);buttons.set(img,button);}
      button.style.right=Math.max(6,innerWidth-rect.right+6)+'px';button.style.top=Math.max(4,rect.top+6)+'px';
    }
    for(const [img,button]of buttons)if(!keep.has(img)){button.remove();buttons.delete(img);}
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}}
  new MutationObserver(records=>{if(records.some(record=>!host.contains(record.target)))schedule();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','style','class']});
  addEventListener('scroll',schedule,true);addEventListener('resize',schedule);document.addEventListener('load',schedule,true);
  chrome.storage.local.get('preferences').then(({preferences})=>{enabled=preferences?.imageButtons!==false;schedule();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.preferences){enabled=changes.preferences.newValue?.imageButtons!==false;schedule();}});
  schedule();
})();
