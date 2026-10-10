import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../extension/image-buttons.js',import.meta.url),'utf8');
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
