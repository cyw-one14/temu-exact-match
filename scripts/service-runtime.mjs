import {readFile,writeFile,open,mkdir,unlink} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const recordPath=path.join(projectRoot,'.local-runtime.json');
const serverPath=path.join(projectRoot,'server','index.mjs');
const cachePath=path.join(projectRoot,'.cache');
const port=Number(process.env.TEMU_MATCH_PORT||43187);
const normalized=value=>path.resolve(String(value)).toLowerCase();

export function requireNodeVersion(version=process.versions.node){
  if(Number(version.split('.')[0])<22)throw new Error('需要 Node.js 22 或更新版本。当前版本：'+version);
}
export function extensionId(key){
  return [...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].map(value=>String.fromCharCode(97+(value>>4),97+(value&15))).join('');
}
export function isOwnedProcess(record,info,root=projectRoot){
  const expected=path.join(root,'server','index.mjs');
  if(!record||!Number.isInteger(record.processId)||record.processId<=0||normalized(record.serverPath||'')!==normalized(expected)||normalized(record.projectRoot||'')!==normalized(root))return false;
  if(!info||info.ProcessId!==record.processId||!/^node(?:\.exe)?$/i.test(info.Name||''))return false;
  // The first Node argument must be this project's server, not a later argument or a similar path.
  const match=String(info.CommandLine||'').match(/^(?:"[^"]*"|\S+)\s+(?:"([^"]*)"|(\S+))(?=\s|$)/);
  return Boolean(match&&normalized(match[1]||match[2])===normalized(expected));
}
async function readRecord(){
  try{return JSON.parse((await readFile(recordPath,'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return null;throw new Error('服务记录无法读取，请检查 .local-runtime.json');}
}
async function processInfo(pid){
  if(!Number.isInteger(pid)||pid<=0)throw new Error('服务进程编号无效');
  if(process.platform!=='win32')throw new Error('该启动器用于 Windows');
  // Inline read-only commands work when execution policy blocks .ps1 files.
  const command="$serviceTaskProcess=Get-CimInstance Win32_Process -Filter 'ProcessId = "+pid+"'; if($serviceTaskProcess){$serviceTaskProcess | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress}";
  const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:6000});
  const value=result.stdout.trim().replace(/^\uFEFF/,'');return value?JSON.parse(value):null;
}
export function readHealth(){
  return new Promise(resolve=>{
    const request=http.get({hostname:'127.0.0.1',port,path:'/health',agent:false},response=>{
      let body='';response.setEncoding('utf8');
      response.on('data',chunk=>{body+=chunk;if(body.length>64000)request.destroy();});
      response.on('end',()=>{try{resolve(response.statusCode===200?JSON.parse(body):null);}catch{resolve(null);}});
      response.on('error',()=>resolve(null));
    });
    request.setTimeout(1500,()=>request.destroy());request.on('error',()=>resolve(null));
  });
}
async function portIsFree(){
  return new Promise(resolve=>{const probe=net.createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});
}
async function stopOwned(record){
  if(normalized(record.serverPath||'')!==normalized(serverPath)||normalized(record.projectRoot||'')!==normalized(projectRoot))throw new Error('服务记录不属于本项目，未停止任何进程');
  const info=await processInfo(record.processId);
  if(!info){await unlink(recordPath).catch(error=>{if(error.code!=='ENOENT')throw error;});return false;}
  if(!isOwnedProcess(record,info))throw new Error('记录中的进程不属于本项目，未停止任何进程');
  // Updating the owned Node server must also release its Python child.
  await execute('taskkill.exe',['/PID',String(record.processId),'/T','/F'],{windowsHide:true,timeout:10000});
  for(let attempt=0;attempt<30;attempt++){
    try{process.kill(record.processId,0);}catch(error){if(error.code==='ESRCH')break;throw error;}
    await delay(100);
  }
  await unlink(recordPath).catch(error=>{if(error.code!=='ENOENT')throw error;});return true;
}
export async function stopService(){
  const record=await readRecord();if(!record){console.log('没有本项目记录的识别服务。');return;}
  console.log(await stopOwned(record)?'本项目的识别服务已停止。':'服务已经停止，已清理过期记录。');
}
async function serviceEnvironment(){
  const env={...process.env};
  if(!env.HTTPS_PROXY&&!env.HTTP_PROXY){
    try{
      const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$serviceTaskUri=[uri]'https://huggingface.co/'; [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($serviceTaskUri).AbsoluteUri"],{windowsHide:true,timeout:5000});
      const proxy=new URL(result.stdout.trim());
      if(proxy.hostname!=='huggingface.co'&&['http:','https:'].includes(proxy.protocol)){env.HTTPS_PROXY=proxy.href;env.HTTP_PROXY=proxy.href;}
    }catch{/* Existing model cache and direct connections remain available. */}
  }
  if(env.HTTPS_PROXY||env.HTTP_PROXY)env.NODE_USE_ENV_PROXY='1';
  env.NO_PROXY=[env.NO_PROXY,'localhost','127.0.0.1'].filter(Boolean).join(',');
  return env;
}
async function openSetup(){
  if(process.env.TEMU_MATCH_NO_OPEN==='1')return;
  await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Start-Process 'http://127.0.0.1:43187/setup'"],{windowsHide:true,timeout:5000}).catch(()=>console.log('请在浏览器打开：http://127.0.0.1:43187/setup'));
}
export async function startService({showSetup=false}={}){
  requireNodeVersion();
  const manifest=JSON.parse(await readFile(path.join(projectRoot,'extension','manifest.json'),'utf8'));
  if(!manifest.key){await execute(process.execPath,[path.join(projectRoot,'scripts','init-key.mjs')],{windowsHide:true});manifest.key=JSON.parse(await readFile(path.join(projectRoot,'extension','manifest.json'),'utf8')).key;}
  const id=extensionId(manifest.key),installationId=createHash('sha256').update(projectRoot.toLowerCase()).digest('hex').slice(0,20);
  const ready=health=>health?.ok&&health.version===manifest.version&&health.extensionId===id&&health.installationId===installationId;
  let health=await readHealth();
  if(ready(health)){console.log('TEMU 识别服务已在运行：http://127.0.0.1:43187/setup');if(showSetup)await openSetup();return health;}
  await mkdir(cachePath,{recursive:true});
  const lockPath=path.join(cachePath,'service-start.lock');let lock;
  try{lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    let previous;try{previous=JSON.parse(await readFile(lockPath,'utf8'));}catch{previous={};}
    let active=Number.isInteger(previous.pid)&&previous.pid>0;
    if(active)try{process.kill(previous.pid,0);}catch(failure){if(failure.code==='ESRCH')active=false;else throw failure;}
    if(active){
      for(let attempt=0;attempt<40;attempt++){await delay(300);health=await readHealth();if(ready(health)){console.log('TEMU 识别服务已启动：http://127.0.0.1:43187/setup');if(showSetup)await openSetup();return health;}}
      throw new Error('另一次启动尚未完成，请稍后重试');
    }
    await unlink(lockPath);return startService({showSetup});
  }
  try{
    health=await readHealth();
    if(!ready(health)){
      const record=await readRecord();
      if(record){
        const info=await processInfo(record.processId);
        if(info){if(isOwnedProcess(record,info))await stopOwned(record);else if(!await portIsFree())throw new Error('43187 端口被占用，服务记录中的进程不属于本项目');}
        else await stopOwned(record);
      }
      if(!await portIsFree())throw new Error('43187 端口被其他程序占用，请关闭占用程序后重试');
      const env=await serviceEnvironment();
      const stdout=await open(path.join(cachePath,'service.log'),'a'),stderr=await open(path.join(cachePath,'service-error.log'),'a');
      await stdout.write('\n['+new Date().toISOString()+'] 启动 '+manifest.version+'\n');
      let child;
      try{
        child=spawn(process.execPath,[serverPath],{cwd:projectRoot,env,windowsHide:true,detached:true,stdio:['ignore',stdout.fd,stderr.fd]});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      }finally{await stdout.close();await stderr.close();}
      const newRecord={processId:child.pid,serverPath,projectRoot};await writeFile(recordPath,JSON.stringify(newRecord,null,2));
      for(let attempt=0;attempt<60;attempt++){health=await readHealth();if(ready(health))break;try{process.kill(child.pid,0);}catch{break;}await delay(300);}
      if(!ready(health)){
        await stopOwned(newRecord);
        const details=(await readFile(path.join(cachePath,'service-error.log'),'utf8')).trim().slice(-1600);
        throw new Error('识别服务启动失败。'+(details?'\n'+details:'请查看 .cache\\service-error.log'));
      }
    }
    console.log('TEMU 识别服务已启动：http://127.0.0.1:43187/setup');
    if(health.model?.message)console.log(health.model.message);
    if(showSetup)await openSetup();return health;
  }finally{await lock.close();await unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
