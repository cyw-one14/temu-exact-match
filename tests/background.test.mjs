import test from 'node:test';
import assert from 'node:assert/strict';
const calls=[];let listener,tabFailure=null,tabUrl='https://attacker.example';
const durable={};
globalThis.chrome={runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onInstalled:{addListener:()=>{}},onMessage:{addListener:fn=>{listener=fn;}}},action:{onClicked:{addListener:()=>{}}},sidePanel:{open:options=>{calls.push({type:'open',options});return Promise.resolve();}},storage:{session:{set:async value=>{calls.push({type:'save',value});}},local:{get:async key=>({[key]:structuredClone(durable[key])}),set:async data=>Object.assign(durable,structuredClone(data))}},tabs:{get:async()=>{if(tabFailure)throw tabFailure;return{url:tabUrl};}}};
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
test('sidebar rejection and synchronous failure preserve selection before opening the same assistant in a normal tab',async()=>{
  const originalOpen=chrome.sidePanel.open,originalCreate=chrome.tabs.create;
  try{
    for(const synchronous of [true,false]){
      const events=[];chrome.sidePanel.open=()=>{events.push('sidebar');if(synchronous)throw Error('Sidebar unavailable');return Promise.reject(Error('User gesture refused'));};
      chrome.tabs.create=async options=>{events.push('tab');assert.equal(options.url,'chrome-extension://test-extension/panel.html');assert.equal(options.windowId,2);assert.equal(options.active,true);assert.equal(calls.at(-1).value['temuSelection:2'].imageUrl,'https://img.kwcdn.com/selected.jpg');return{id:77};};
      const response=await new Promise(resolve=>listener({type:'image-picked',selection:{imageUrl:'https://img.kwcdn.com/selected.jpg',productId:'601123456789001'}},{id:'test-extension',tab:{id:3,windowId:2,url:'https://www.temu.com/goods.html?goods_id=601123456789001'}},resolve));
      assert.equal(response.ok,true);assert.equal(response.opened,'tab');assert.deepEqual(events,['sidebar','tab']);
    }
  }finally{chrome.sidePanel.open=originalOpen;chrome.tabs.create=originalCreate;}
});
test('failed sidebar and fallback, or failed selection storage, return actionable errors instead of hanging',async()=>{
  const originalOpen=chrome.sidePanel.open,originalCreate=chrome.tabs.create,originalSave=chrome.storage.session.set;let tabs=0;
  const request=()=>new Promise(resolve=>listener({type:'image-picked',selection:{imageUrl:'https://img.kwcdn.com/selected.jpg'}},{id:'test-extension',tab:{id:3,windowId:2,url:'https://www.temu.com/'}},resolve));
  try{
    chrome.sidePanel.open=()=>Promise.reject(Error('Refused'));chrome.tabs.create=async()=>{tabs++;throw Error('Window closed');};let response=await request();assert.equal(response.ok,false);assert.match(response.error,/侧栏或助手标签页/);
    chrome.sidePanel.open=()=>Promise.resolve();chrome.storage.session.set=async()=>{throw Error('Session quota exceeded');};response=await request();assert.equal(response.ok,false);assert.match(response.error,/所选图片无法保存/);assert.equal(tabs,1);
  }finally{chrome.sidePanel.open=originalOpen;chrome.tabs.create=originalCreate;chrome.storage.session.set=originalSave;}
});

test('only assistant panels can persist user classification and storage failures return a visible error',async()=>{
  const message={type:'manual-memory-update',referenceKey:'goods:601123456789900',entries:[{candidateKey:'provider-visible:601123456789001',decision:'same'}]};
  assert.equal(listener(message,{id:'test-extension',url:'https://www.temu.com/'},()=>{}),false);
  assert.equal(listener(message,{id:'another-extension',url:'chrome-extension://test-extension/panel.html'},()=>{}),false);
  const sender={id:'test-extension',url:'chrome-extension://test-extension/panel.html'};
  const response=await new Promise(resolve=>listener(message,sender,resolve));assert.equal(response.ok,true);assert.equal(response.record.entries[message.entries[0].candidateKey].decision,'same');
  const original=chrome.storage.local.set;try{
    chrome.storage.local.set=async()=>{throw Error('TEST quota');};const failed=await new Promise(resolve=>listener({...message,entries:[{...message.entries[0],decision:'different'}]},sender,resolve));
    assert.equal(failed.ok,false);assert.match(failed.error,/人工分类长期保存失败/);assert.equal(durable['temuManual:v1:'+message.referenceKey].entries[message.entries[0].candidateKey].decision,'same');
  }finally{chrome.storage.local.set=original;}
});
