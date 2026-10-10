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
$('open-setup').addEventListener('click',()=>chrome.tabs.create({url:'http://127.0.0.1:43187/setup'}));
$('open-temu').addEventListener('click',()=>chrome.tabs.create({url:'https://www.temu.com/'}));
try{
  const health=await(await fetch('http://127.0.0.1:43187/health',{signal:AbortSignal.timeout(3000)})).json();
  $('health').textContent=health.engine==='local'?health.model.message:'云端视觉服务'+(health.configured?'已配置':'缺少密钥');
}catch{$('health').textContent='尚未连接。请先双击“启动服务.cmd”。';}
