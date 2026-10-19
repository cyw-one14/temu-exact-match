import {engineRequest,closeEngine} from './local-engine-client.mjs';
const $=id=>document.getElementById(id);
const saved=(await chrome.storage.local.get('preferences')).preferences;
if(saved?.maxCandidates)$('max-candidates').value=saved.maxCandidates;
$('image-buttons').checked=saved?.imageButtons!==false;
$('on-image-click').value=saved?.onImageClick||'provider';
$('provider-period').value=saved?.providerPeriod||'unknown';
$('save').addEventListener('click',async()=>{
  const maxCandidates=Number($('max-candidates').value);
  if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>40){$('message').textContent='请填写 1–40 之间的整数';return;}
  await chrome.storage.local.set({preferences:{...saved,maxCandidates,imageButtons:$('image-buttons').checked,onImageClick:$('on-image-click').value,providerPeriod:$('provider-period').value}});$('message').textContent='全部设置已保存';
});
$('open-setup').addEventListener('click',async()=>{try{$('health').textContent='正在准备本机助手…';await engineRequest('/prepare',{});$('health').textContent='本机识别已就绪，会在登录电脑时自动启动。';}catch(error){$('health').textContent='准备失败：'+error.message;}});
$('open-temu').addEventListener('click',()=>chrome.tabs.create({url:'https://www.temu.com/'}));
try{
  const health=await engineRequest('/health');
  $('health').textContent=health.model.state==='ready'?'本机识别已就绪，会在登录电脑时自动启动。':health.model.message;
}catch{$('health').textContent='本机助手未就绪，请点“检查后台服务”重试。';}
window.addEventListener('pagehide',closeEngine);
