import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../extension/image-buttons.js',import.meta.url),'utf8');
const declarations=await readFile(new URL('../extension/structured-fields.js',import.meta.url),'utf8');

async function mount(html,{url='https://www.temu.com/goods.html?goods_id=601123456789001',front=''}={}){
  const {document}=parseHTML(html);let shadow;const original=document.createElement.bind(document),frames=[],messages=[];
  document.createElement=(...args)=>{const node=original(...args),attach=node.attachShadow.bind(node);node.attachShadow=options=>{shadow=attach(options);return shadow;};return node;};
  for(const img of document.querySelectorAll('img')){const size=img.getAttribute('data-small')?100:600;img.getBoundingClientRect=()=>({left:20,top:30,right:20+size,bottom:30+size,width:size,height:size});img.getClientRects=()=>[img.getBoundingClientRect()];}
  if(front)document.elementsFromPoint=()=>[document.getElementById(front),document.querySelector('main')];
  const context=vm.createContext({document,location:new URL(url),URL,Map,Set,String,innerWidth:1000,innerHeight:800,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{observe(){}},getComputedStyle:node=>({display:node.style.display||'block',visibility:node.style.visibility||'visible',opacity:node.style.opacity||'1'}),addEventListener:()=>{},setTimeout:()=>0,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true};}},storage:{local:{get:async()=>({})},onChanged:{addListener:()=>{}}}}});
  vm.runInContext(declarations,context);vm.runInContext(source,context);await Promise.resolve();while(frames.length)frames.shift()();
  return {document,shadow,messages,flush:()=>{while(frames.length)frames.shift()();}};
}

test('detail hero keeps its visible currentSrc and current product ID despite nearby recommendation links, and uses the real page title',async()=>{
  const app=await mount('<html><head><title>3双厚实的防水厨房手套-米色和薄荷绿，用于洗碗 - Temu</title></head><body><main><section><img id="hero" src="https://img.kwcdn.com/stale-thumbnail.jpg" alt="商品图片"><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><h2>Unrelated pressure gauge</h2></a></section><a href="https://www.temu.com/goods.html?goods_id=601123456789003"><img data-small src="https://img.kwcdn.com/recommendation.jpg" alt="Other product"></a></main></body></html>');
  Object.defineProperty(app.document.getElementById('hero'),'currentSrc',{value:'https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg?imageView2/2/w/800',configurable:true});
  app.shadow.querySelector('button').click();await Promise.resolve();
  const selected=app.messages[0].selection;assert.equal(selected.productId,'601123456789001');assert.ok(selected.imageUrl.includes('3a9883af'));assert.equal(selected.title,app.document.title);assert.equal(selected.titleSource,'current-document-title');assert.equal(selected.productIdSource,'current-product-gallery');
});

test('hidden and covered carousel slides cannot supply overlapping buttons or send a stale selection after a slide switch',async()=>{
  const app=await mount('<html><head><title>Actual glove title</title></head><body><main><div data-product-gallery><img id="visible" src="https://img.kwcdn.com/glove.jpg"><div aria-hidden="true"><img src="https://img.kwcdn.com/hidden.jpg"></div><div style="opacity:0"><img src="https://img.kwcdn.com/transparent.jpg"></div><img id="covered" src="https://img.kwcdn.com/covered.jpg"></div></main></body></html>',{front:'visible'});
  assert.equal(app.shadow.querySelectorAll('button').length,1);const button=app.shadow.querySelector('button');button.click();assert.equal(app.messages[0].selection.imageUrl,'https://img.kwcdn.com/glove.jpg');
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
