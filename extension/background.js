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
      const selection={id:crypto.randomUUID(),windowId:sender.tab.windowId,tabId:sender.tab.id,imageUrl:officialImage(message.selection.imageUrl),productId:/^\d{6,25}$/.test(message.selection.productId||'')?message.selection.productId:'',title:String(message.selection.title||'').slice(0,400),pageUrl:sender.tab.url};
      await chrome.storage.session.set({['temuSelection:'+sender.tab.windowId]:selection});sendResponse({ok:true});
    }).catch(error=>sendResponse({ok:false,error:'打开侧栏失败：'+error.message}));
    return true;
  }
  if(message.type==='collect'){
    collect(message.tabId).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message.type==='collect-provider'&&sender.url===chrome.runtime.getURL('panel.html')){
    collectProvider(message.tabId).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  return false;
});

async function collect(tabId){
  const tab=await chrome.tabs.get(tabId);
  const url=new URL(tab.url||'https://invalid.local');
  if(url.protocol!=='https:'||url.hostname!=='www.temu.com')throw new Error('请先打开 TEMU 美国站商品页或搜索结果页');
  const results=await chrome.scripting.executeScript({target:{tabId},files:['extract.js']});
  const data=results[0]?.result;
  if(!data)throw new Error('无法读取当前页面，请刷新 TEMU 页面后重试');
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
  const results=await chrome.scripting.executeScript({target:{tabId},files:['provider-extract.js']});
  if(!results[0]?.result)throw new Error('图搜页面暂时无法读取，请等待加载后重试');
  return results[0].result;
}
