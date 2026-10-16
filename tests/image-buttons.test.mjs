import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../extension/image-buttons.js',import.meta.url),'utf8');
const declarations=await readFile(new URL('../extension/structured-fields.js',import.meta.url),'utf8');

async function mount(html,{url='https://www.temu.com/goods.html?goods_id=601123456789001',front='',rect=null,send=null}={}){
  const {document}=parseHTML(html);let shadow;const original=document.createElement.bind(document),frames=[],messages=[];
  document.createElement=(...args)=>{const node=original(...args),attach=node.attachShadow.bind(node);node.attachShadow=options=>{shadow=attach(options);return shadow;};return node;};
  for(const img of document.querySelectorAll('img')){const size=img.getAttribute('data-small')?100:600;img.getBoundingClientRect=()=>typeof rect==='function'?rect(img):rect||({left:20,top:30,right:20+size,bottom:30+size,width:size,height:size});img.getClientRects=()=>[img.getBoundingClientRect()];}
  if(front)document.elementsFromPoint=(x,y)=>typeof front==='function'?front(document,x,y):[document.getElementById(front),document.querySelector('main')];
  const timers=new Map();let timerId=0;
  const context=vm.createContext({document,location:new URL(url),URL,Map,Set,String,Number,Math,innerWidth:1000,innerHeight:800,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{observe(){}},getComputedStyle:node=>({display:node.style.display||'block',visibility:node.style.visibility||'visible',opacity:node.style.opacity||'1'}),addEventListener:()=>{},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),chrome:{runtime:{sendMessage:message=>{messages.push(message);return send?send(message):Promise.resolve({ok:true});}},storage:{local:{get:async()=>({})},onChanged:{addListener:()=>{}}}}});
  vm.runInContext(declarations,context);vm.runInContext(source,context);await Promise.resolve();while(frames.length)frames.shift()();
  return {document,shadow,messages,timers,flush:()=>{while(frames.length)frames.shift()();}};
}

test('a visible button clipped to the viewport edge still dispatches its own product image',async()=>{
  const app=await mount('<html><body><main><img src="https://img.kwcdn.com/a.jpg" alt="Actual gloves"></main></body></html>',{rect:{left:970,top:30,right:1170,bottom:230,width:200,height:200}});
  const event=new app.document.defaultView.Event('click');Object.assign(event,{clientX:955,clientY:50});app.shadow.querySelector('button').dispatchEvent(event);await Promise.resolve();
  assert.equal(app.messages.length,1);assert.equal(app.messages[0].selection.productId,'601123456789001');
});

test('a detail hero inside a non-product zoom link keeps its own button instead of leaving only the thumbnail',async()=>{
  const app=await mount('<html><head><title>Actual glove title</title></head><body><main><div><a href="https://img.kwcdn.com/hero.jpg"><img id="hero" src="https://img.kwcdn.com/hero.jpg"></a></div><img data-small src="https://img.kwcdn.com/thumb.jpg"></main></body></html>');
  for(const button of app.shadow.querySelectorAll('button'))button.click();
  assert.ok(app.messages.some(message=>message.selection.imageUrl==='https://img.kwcdn.com/hero.jpg'&&message.selection.productId==='601123456789001'));
});
test('an offscreen larger carousel image cannot displace the visible detail hero',async()=>{
  const app=await mount('<html><body><main><img id="hero" src="https://img.kwcdn.com/hero.jpg"><img id="offscreen" src="https://img.kwcdn.com/preload.jpg"></main></body></html>',{rect:img=>img.id==='offscreen'?{left:20,top:1200,right:1220,bottom:2400,width:1200,height:1200}:{left:20,top:30,right:620,bottom:630,width:600,height:600}});
  assert.equal(app.shadow.querySelectorAll('button').length,1);app.shadow.querySelector('button').click();assert.equal(app.messages[0].selection.imageUrl,'https://img.kwcdn.com/hero.jpg');
});
test('the current page main-image address binds a visible hero independently of a larger neighboring image',async()=>{
  const app=await mount('<html><head><title>Actual glove title</title></head><body><main><img id="hero" src="https://img.kwcdn.com/hero.jpg?imageView2/2/w/800"><img id="other" src="https://img.kwcdn.com/other.jpg"></main></body></html>',{url:'https://www.temu.com/us-zh-Hans/gloves-g-601123456789001.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fhero.jpg',rect:img=>img.id==='other'?{left:640,top:30,right:990,bottom:780,width:350,height:750}:{left:20,top:30,right:420,bottom:430,width:400,height:400}});
  for(const button of app.shadow.querySelectorAll('button'))button.click();
  const hero=app.messages.find(message=>message.selection.imageUrl.includes('/hero.jpg'));assert.ok(hero);assert.equal(hero.selection.productId,'601123456789001');assert.equal(hero.selection.productIdSource,'current-page-image');
});
test('a page main-image parameter never rebinds a different product card or an external shop link to the current product',async()=>{
  const app=await mount('<html><body><main><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/hero.jpg"></a><a href="https://shop.example/product"><img src="https://img.kwcdn.com/other.jpg"></a></main></body></html>',{url:'https://www.temu.com/goods.html?goods_id=601123456789001&top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fhero.jpg'});
  assert.equal(app.shadow.querySelectorAll('button').length,1);app.shadow.querySelector('button').click();assert.equal(app.messages[0].selection.productId,'601123456789002');assert.equal(app.messages[0].selection.productIdSource,'enclosing-product-link');
});
test('a small image over the hero center does not hide the hero button, while fully covered slides remain excluded',async()=>{
  const app=await mount('<html><body><main><img id="hero" src="https://img.kwcdn.com/hero.jpg"><img id="badge" src="https://img.kwcdn.com/badge.jpg" alt="Temu"></main></body></html>',{rect:img=>img.id==='badge'?{left:270,top:280,right:370,bottom:380,width:100,height:100}:{left:20,top:30,right:620,bottom:630,width:600,height:600},front:(document,x,y)=>[document.getElementById(x>=270&&x<=370&&y>=280&&y<=380?'badge':'hero'),document.querySelector('main')]});
  assert.equal(app.shadow.querySelectorAll('button').length,1);app.shadow.querySelector('button').click();assert.equal(app.messages[0].selection.imageUrl,'https://img.kwcdn.com/hero.jpg');
});
test('an extension context invalidated synchronously on click shows a refresh instruction instead of throwing silently',async()=>{
  const app=await mount('<html><body><main><img src="https://img.kwcdn.com/a.jpg" alt="Actual gloves"></main></body></html>',{send:()=>{throw Error('Extension context invalidated.');}});
  assert.doesNotThrow(()=>app.shadow.querySelector('button').click());await Promise.resolve();assert.match(app.shadow.querySelector('.message').textContent,/刷新 TEMU 页面/);assert.equal(app.shadow.querySelector('button').disabled,false);
});

test('detail hero keeps its visible currentSrc and current product ID despite nearby recommendation links, and uses the real page title',async()=>{
  const app=await mount('<html><head><title>3双厚实的防水厨房手套-米色和薄荷绿，用于洗碗 - Temu</title></head><body><main><section><img id="hero" src="https://img.kwcdn.com/stale-thumbnail.jpg" alt="商品图片"><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><h2>Unrelated pressure gauge</h2></a></section><a href="https://www.temu.com/goods.html?goods_id=601123456789003"><img data-small src="https://img.kwcdn.com/recommendation.jpg" alt="Other product"></a></main></body></html>');
  Object.defineProperty(app.document.getElementById('hero'),'currentSrc',{value:'https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg?imageView2/2/w/800',configurable:true});
  app.shadow.querySelector('button').click();await Promise.resolve();
  const selected=app.messages[0].selection;assert.equal(selected.productId,'601123456789001');assert.ok(selected.imageUrl.includes('3a9883af'));assert.equal(selected.title,app.document.title);assert.equal(selected.titleSource,'current-document-title');assert.equal(selected.productIdSource,'current-product-gallery');
});

test('hidden and covered carousel slides cannot supply overlapping buttons or send a stale selection after a slide switch',async()=>{
  const app=await mount('<html><head><title>Actual glove title</title></head><body><main><div data-product-gallery><img id="visible" src="https://img.kwcdn.com/glove.jpg"><div aria-hidden="true"><img src="https://img.kwcdn.com/hidden.jpg"></div><div style="opacity:0"><img src="https://img.kwcdn.com/transparent.jpg"></div><img id="covered" src="https://img.kwcdn.com/covered.jpg"></div></main></body></html>',{front:'visible'});
  assert.equal(app.shadow.querySelectorAll('button').length,1);const button=app.shadow.querySelector('button');button.click();assert.equal(app.messages[0].selection.imageUrl,'https://img.kwcdn.com/glove.jpg');
  await new Promise(resolve=>setImmediate(resolve));
  app.document.getElementById('visible').setAttribute('hidden','');button.click();assert.equal(app.messages.length,1,'stale hidden image cannot be dispatched');app.flush();assert.equal(app.shadow.querySelectorAll('button').length,0);
});

test('card and public product titles stay bound to the selected image rather than a neighboring product or generic alt',async()=>{
  const app=await mount('<html><body><main><article><a href="https://www.temu.com/goods.html?goods_id=601123456789001"><img src="https://img.kwcdn.com/a.jpg" alt="商品图片"></a><span data-tooltip="goodName-1" data-tooltip-title="3 pairs Actual Latex Gloves"></span></article><article><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/b.jpg" alt="Generic"><h3>Other product title</h3></a></article><script type="application/ld+json">{"@type":"Product","url":"https://www.temu.com/goods.html?goods_id=601123456789001","name":"Declared glove name","image":"https://img.kwcdn.com/a.jpg"}</script></main></body></html>',{url:'https://www.temu.com/search_result.html'});
  const buttons=app.shadow.querySelectorAll('button');buttons[0].click();buttons[1].click();assert.equal(app.messages[0].selection.title,'Declared glove name');assert.equal(app.messages[0].selection.titleSource,'public-jsonld');assert.equal(app.messages[1].selection.title,'Other product title');assert.equal(app.messages[1].selection.productId,'601123456789002');
});

test('a missing title stays empty instead of borrowing a title from recommendations',async()=>{
  const app=await mount('<html><body><main><img src="https://img.kwcdn.com/a.jpg" alt="商品图片"><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><h2>Pressure gauge</h2></a></main></body></html>');app.shadow.querySelector('button').click();assert.equal(app.messages[0].selection.title,'');assert.equal(app.messages[0].selection.productId,'601123456789001');
});

test('a card sibling tooltip supplies its literal title and a detail page without main still binds the hero to its own ID',async()=>{
  const card=await mount('<html><body><article><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/a.jpg" alt="商品图片"></a><span data-tooltip="goodName-2" data-tooltip-title="Actual cleaning glove card title"></span></article></body></html>',{url:'https://www.temu.com/search_result.html'});card.shadow.querySelector('button').click();assert.equal(card.messages[0].selection.title,'Actual cleaning glove card title');assert.equal(card.messages[0].selection.productId,'601123456789002');
  const detail=await mount('<html><head><title>Actual detail glove title - Temu</title></head><body><div><img src="https://img.kwcdn.com/a.jpg" alt="商品图片"><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><h2>Recommended gauge</h2></a></div></body></html>');detail.shadow.querySelector('button').click();assert.equal(detail.messages[0].selection.productId,'601123456789001');assert.equal(detail.messages[0].selection.title,detail.document.title);
});
test('buttons follow visible product images, pass the selected product, and disappear when disabled',async()=>{
  const {document,window}=parseHTML('<html><body><main><article><a href="https://www.temu.com/blue-g-601123456789001.html"><img id="product" src="https://img.kwcdn.com/blue.jpg" alt="Logo print bottle"></a></article><img id="logo" src="https://img.kwcdn.com/logo.png" alt="Temu"><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img id="small" src="https://img.kwcdn.com/tiny.jpg"></a></main></body></html>');
  let rect={left:100,top:200,right:300,bottom:400,width:200,height:200};
  for(const img of document.querySelectorAll('img')){img.getBoundingClientRect=()=>img.id==='small'?{...rect,width:30,height:30}:rect;img.getClientRects=()=>[rect];}
  let shadow,storageListener;const original=document.createElement.bind(document);
  document.createElement=(...args)=>{const node=original(...args),attach=node.attachShadow.bind(node);node.attachShadow=options=>{shadow=attach(options);return shadow;};return node;};
  const frames=[],events={},messages=[];
  const context=vm.createContext({document,location:new URL('https://www.temu.com/search_result.html'),URL,Map,Set,String,innerWidth:1000,innerHeight:800,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{observe(){}},addEventListener:(name,fn)=>events[name]=fn,setTimeout:()=>0,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true};}},storage:{local:{get:async()=>({preferences:{imageButtons:true}})},onChanged:{addListener:fn=>storageListener=fn}}}});
  vm.runInContext(source,context);await Promise.resolve();while(frames.length)frames.shift()();
  assert.equal(shadow.querySelectorAll('button').length,1);
  const button=shadow.querySelector('button');assert.equal(button.style.right,'706px');assert.equal(button.style.top,'206px');button.click();await Promise.resolve();
  assert.equal(messages[0].selection.productId,'601123456789001');assert.equal(messages[0].selection.imageUrl,'https://img.kwcdn.com/blue.jpg');
  rect={...rect,top:100,bottom:300,right:420};events.scroll();while(frames.length)frames.shift()();assert.equal(button.style.top,'106px');assert.equal(button.style.right,'586px');
  storageListener({preferences:{newValue:{imageButtons:false}}},'local');while(frames.length)frames.shift()();assert.equal(shadow.querySelectorAll('button').length,0);
  vm.runInContext(source,context);assert.equal(document.querySelectorAll('#temu-exact-image-buttons').length,1);
});

test('pending clicks show progress, suppress duplicates, time out visibly and ignore an older late acknowledgement',async()=>{
  const replies=[];const app=await mount('<html><body><main><img src="https://img.kwcdn.com/a.jpg" alt="Actual gloves"></main></body></html>',{send:()=>new Promise(resolve=>replies.push(resolve))});
  const button=app.shadow.querySelector('button');button.click();assert.equal(button.disabled,true);assert.equal(button.textContent,'正在打开…');button.click();assert.equal(app.messages.length,1);
  [...app.timers.values()][0].fn();assert.equal(button.disabled,false);assert.match(app.shadow.querySelector('.message').textContent,/暂未响应/);
  button.click();assert.equal(app.messages.length,2);replies[0]({ok:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(button.disabled,true);
  replies[1]({ok:false,error:'Actual startup failure'});await new Promise(resolve=>setImmediate(resolve));assert.equal(button.disabled,false);assert.equal(app.shadow.querySelector('.message').textContent,'Actual startup failure');
});
test('a moved image requests a refreshed button instead of silently ignoring a click or picking a different image',async()=>{
  const rect={left:20,top:30,right:620,bottom:630,width:600,height:600};const app=await mount('<html><body><main><img src="https://img.kwcdn.com/a.jpg" alt="Actual gloves"></main></body></html>',{rect});const button=app.shadow.querySelector('button');rect.top=100;rect.bottom=700;
  button.click();assert.equal(app.messages.length,0);assert.match(app.shadow.querySelector('.message').textContent,/图片位置已变化/);app.flush();button.click();assert.equal(app.messages.length,1);assert.equal(app.messages[0].selection.imageUrl,'https://img.kwcdn.com/a.jpg');
});
