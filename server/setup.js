const $=id=>document.getElementById(id);
async function health(){try{const data=await(await fetch('/health')).json();$('model-status').textContent=data.model.state==='ready'?'本机识别已就绪':data.model.message;$('runtime').textContent='版本 '+data.version+' · '+(data.acceleration?.device==='dml'?'本机显卡':'本机CPU')+' · 后台常驻';$('prepare').disabled=data.model.state==='loading';}catch{$('model-status').textContent='后台未连接，请检查安装是否完成';}}
$('prepare').onclick=health;
$('copy-path').onclick=async()=>{try{await navigator.clipboard.writeText($('extension-path').value);$('message').textContent='路径已复制，在扩展管理页选择这个文件夹。';}catch{$('message').textContent='请手动复制上面的文件夹路径。';}};
fetch('/config',{headers:{'X-Temu-Client':'exact-match'}}).then(r=>r.json()).then(data=>{$('extension-path').value=data.extensionPath||'';}).catch(()=>{});
health();setInterval(health,5000);
