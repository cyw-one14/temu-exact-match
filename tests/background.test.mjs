import test from 'node:test';
import assert from 'node:assert/strict';
const calls=[];let listener,tabFailure=null,tabUrl='https://attacker.example';
globalThis.chrome={runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onInstalled:{addListener:()=>{}},onMessage:{addListener:fn=>{listener=fn;}}},action:{onClicked:{addListener:()=>{}}},sidePanel:{open:options=>{calls.push({type:'open',options});return Promise.resolve();}},storage:{session:{set:async value=>{calls.push({type:'save',value});}}},tabs:{get:async()=>{if(tabFailure)throw tabFailure;return{url:tabUrl};}}};
await import('../extension/background.js');
test('the image click opens the panel before asynchronous selection storage and carries only the selected image',async()=>{
  const response=await new Promise(resolve=>listener({type:'image-picked',selection:{imageUrl:'https://img.kwcdn.com/a.jpg',productId:'601123456789001',title:'Bottle'}},{id:'test-extension',tab:{id:3,windowId:2,url:'https://www.temu.com/search_result.html'}},resolve));
  assert.equal(response.ok,true);assert.equal(calls[0].type,'open');assert.equal(calls[1].type,'save');assert.equal(calls[1].value['temuSelection:2'].tabId,3);
});
test('untrusted senders, non-TEMU tabs and arbitrary image hosts cannot initiate a lookup',()=>{
  const before=calls.length;
  assert.equal(listener({type:'image-picked',selection:{imageUrl:'https://img.kwcdn.com/a.jpg'}},{id:'other'},()=>{}),false);
  let response;listener({type:'image-picked',selection:{imageUrl:'https://attacker.example/a.jpg'}},{id:'test-extension',tab:{url:'https://www.temu.com/',windowId:1}},value=>response=value);
  assert.equal(response.ok,false);assert.equal(calls.length,before);
});
test('provider collection refuses navigation to other websites',async()=>{
  const response=await new Promise(resolve=>listener({type:'collect-provider',tabId:1},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));assert.equal(response.ok,false);assert.match(response.error,/图搜页面/);
});
test('a closed provider tab returns an actionable message instead of a raw browser error',async()=>{
  tabFailure=new Error('No tab with id: 805660750.');
  const response=await new Promise(resolve=>listener({type:'collect-provider',tabId:805660750},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));
  assert.equal(response.ok,false);assert.match(response.error,/图搜标签页已关闭/);assert.match(response.error,/重新打开/);
  tabFailure=null;
});
test('collection injects bounded public-data helpers into the existing page and anchors gallery to the selected image',async()=>{
 tabUrl='https://www.temu.com/goods.html?goods_id=601123456789001';const scripts=[];
 chrome.scripting={executeScript:async options=>{scripts.push(options);return options.files?[{result:{products:[],detail:{id:'601123456789001'}}}]:[{result:undefined}];}};
 const response=await new Promise(resolve=>listener({type:'collect',tabId:3,selectedImageUrl:'https://img.kwcdn.com/main.jpg'},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));
 assert.equal(response.ok,true);assert.equal(response.data.detail.id,'601123456789001');assert.deepEqual(scripts[0].args,['https://img.kwcdn.com/main.jpg']);assert.deepEqual(scripts[1].files,['structured-fields.js','extract.js']);assert.equal(scripts.every(item=>item.target.tabId===3),true);
 tabUrl='https://attacker.example';
});
test('result navigation is panel-only and refuses product pages before injecting any action',async()=>{
  const sender={id:'test-extension',url:'chrome-extension://test-extension/panel.html'};
  assert.equal(listener({type:'advance-results',tabId:3,source:'temu'},{...sender,url:'https://www.temu.com/'},()=>{}),false);
  tabUrl='https://www.temu.com/goods.html?goods_id=601123456789001';const scripts=[];
  chrome.scripting={executeScript:async options=>{scripts.push(options);return [{result:{action:'scroll'}}];}};
  const rejected=await new Promise(resolve=>listener({type:'advance-results',tabId:3,source:'temu',queryKey:'x'},sender,resolve));assert.equal(rejected.ok,false);assert.equal(scripts.length,0);
  tabUrl='https://www.temu.com/search_result.html?search_key=gloves';
  const response=await new Promise(resolve=>listener({type:'advance-results',tabId:3,source:'temu',queryKey:'bound-original-query'},sender,resolve));assert.equal(response.ok,true);assert.equal(scripts.length,2);assert.deepEqual(scripts[1].args,[{advance:true,queryKey:'bound-original-query'}]);
  tabUrl='https://attacker.example';
});
