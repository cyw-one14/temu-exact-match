import {officialImage} from './provider.mjs';

chrome.runtime.onInstalled.addListener(()=>chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}));
chrome.action.onClicked.addListener(tab=>chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{}));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id)return false;
  if(message.type==='image-picked'){
    if(!sender.tab||!/^https:\/\/www\.temu\.com\//.test(sender.tab.url||'')||!officialImage(message.selection?.imageUrl)){sendResponse({ok:false,error:'请选择正常 TEMU 页面上的商品图片'});return false;}
    // Call before any await so the content-script click keeps its user gesture.
    const opening=chrome.sidePanel.open({windowId:sender.tab.windowId});
    opening.then(async()=>{
      const selection={id:crypto.randomUUID(),windowId:sender.tab.windowId,tabId:sender.tab.id,imageUrl:officialImage(message.selection.imageUrl),productId:/^\d{6,25}$/.test(message.selection.productId||'')?message.selection.productId:'',title:String(message.selection.title||'').slice(0,400),titleSource:String(message.selection.titleSource||'').slice(0,60),productIdSource:String(message.selection.productIdSource||'').slice(0,60),pageUrl:sender.tab.url};
      await chrome.storage.session.set({['temuSelection:'+sender.tab.windowId]:selection});sendResponse({ok:true});
    }).catch(error=>sendResponse({ok:false,error:'打开侧栏失败：'+error.message}));
    return true;
  }
  if(message.type==='collect'){
    collect(message.tabId,message.selectedImageUrl).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='collect-provider'&&sender.url===chrome.runtime.getURL('panel.html')){
    collectProvider(message.tabId).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='advance-results'&&sender.url===chrome.runtime.getURL('panel.html')){
    advanceResults(message).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  return false;
});

async function collect(tabId,selectedImageUrl){
  const tab=await chrome.tabs.get(tabId);
  const url=new URL(tab.url||'https://invalid.local');
  if(url.protocol!=='https:'||url.hostname!=='www.temu.com')throw new Error('请先打开 TEMU 美国站商品页或搜索结果页');
  const selected=officialImage(selectedImageUrl);
  await chrome.scripting.executeScript({target:{tabId},func:value=>{globalThis.temuSelectedImageUrl=value;},args:[selected]});
  const results=await chrome.scripting.executeScript({target:{tabId},files:['structured-fields.js','extract.js']});
  const data=results.at(-1)?.result;
  if(!data)throw new Error('无法读取当前页面，请刷新 TEMU 页面后重试');
  data.navigation=await resultNavigation(tabId);
  return data;
}

async function collectProvider(tabId){
  let tab;
  try{tab=await chrome.tabs.get(tabId);}catch(error){
    if(/no tab with id|invalid tab id/i.test(error.message))throw new Error('图搜标签页已关闭，请点“打开选品助手图搜”重新打开');
    throw error;
  }
  const url=new URL(tab.url||'https://invalid.local');
  if(url.origin!=='https://www.temaishuju.com')throw new Error('请打开特卖数据的图搜页面');
  const results=await chrome.scripting.executeScript({target:{tabId},files:['structured-fields.js','provider-extract.js']});
  if(!results.at(-1)?.result)throw new Error('图搜页面暂时无法读取，请等待加载后重试');
  const data=results.at(-1).result;
  data.navigation=await resultNavigation(tabId);
  return data;
}

async function resultNavigation(tabId){
  const results=await chrome.scripting.executeScript({target:{tabId},files:['result-navigation.js']});
  return results.at(-1)?.result;
}
async function advanceResults({tabId,queryKey,source}){
  const tab=await chrome.tabs.get(tabId),url=new URL(tab.url||'https://invalid.local');
  const valid=source==='provider'?url.origin==='https://www.temaishuju.com'&&url.pathname==='/plugin/search-image':source==='temu'&&url.origin==='https://www.temu.com'&&url.pathname==='/search_result.html';
  if(!valid)throw new Error('当前标签页已离开本次结果页面，采集已暂停');
  await resultNavigation(tabId);
  const results=await chrome.scripting.executeScript({target:{tabId},func:options=>globalThis.temuResultNavigation(options),args:[{advance:true,queryKey}]});
  return results.at(-1)?.result||{action:'blocked',reason:'navigation-unavailable'};
}
