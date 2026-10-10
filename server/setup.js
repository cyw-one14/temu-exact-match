const $=id=>document.getElementById(id);
const headers={'Content-Type':'application/json','X-Temu-Client':'exact-match'};
async function request(path,body){const response=await fetch(path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok||value.ok===false)throw new Error(value.error||'请求失败');return value;}
function mode(){const cloud=$('engine').value==='cloud';$('cloud-panel').hidden=!cloud;$('local-panel').hidden=cloud;$('base-url').required=cloud;$('model').required=cloud;}
async function health(){try{const data=await(await fetch('/health')).json();$('model-status').textContent=data.model.message+(data.model.progress!==null?'（'+data.model.progress+'%）':'');$('prepare').disabled=data.model.state==='loading';}catch{$('model-status').textContent='服务未连接';}}
$('engine').addEventListener('change',mode);
$('preset').addEventListener('change',()=>{
  const preset={qwen:['https://dashscope.aliyuncs.com/compatible-mode/v1','qwen3-vl-plus'],openai:['https://api.openai.com/v1','gpt-4.1-mini'],local:['http://127.0.0.1:11434/v1','请填写已安装的视觉模型名称']}[$('preset').value];
  if(preset){$('base-url').value=preset[0];$('model').value=preset[1];$('api-key').value='';$('key-status').textContent='变更服务地址时不会沿用原服务密钥。';}
});
$('prepare').addEventListener('click',async()=>{try{await request('/prepare',{});await health();$('message').textContent='模型开始加载，可保持此页面查看状态。';}catch(error){$('message').textContent=error.message;}});
$('config-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const result=await request('/config',{engine:$('engine').value,baseUrl:$('base-url').value,model:$('model').value,apiKey:$('api-key').value,clearKey:$('clear-key').checked});
    $('api-key').value='';$('clear-key').checked=false;$('key-status').textContent=result.hasKey?'已保存密钥；不显示密钥内容。':'未保存密钥。';$('message').textContent='设置已保存，回到插件开始识别。';
  }catch(error){$('message').textContent=error.message;}
});
request('/config').then(config=>{$('engine').value=config.engine;$('base-url').value=config.baseUrl;$('model').value=config.model;$('key-status').textContent=config.hasKey?'已有密钥，留空可保留。':'尚未配置密钥。';mode();}).catch(error=>{$('message').textContent=error.message;});
health();setInterval(health,5000);
