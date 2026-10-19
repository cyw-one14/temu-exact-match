import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {APP_ID,inside,verifyDistribution} from './distribution.mjs';
import {readHealth} from './service-runtime.mjs';
import {createHash} from 'node:crypto';
const run=promisify(execFile),source=fileURLToPath(new URL('../',import.meta.url));
async function ensureRuntime(root,node){
  const probe=()=>run(node,['--input-type=module','-e',"await import('@huggingface/transformers');"],{cwd:root,windowsHide:true,timeout:30000});
  try{await probe();return;}catch(error){if(!/DLL|specified module|找不到指定|ERR_DLOPEN_FAILED/i.test(error.message))throw error;}
  console.log('这台电脑缺少微软运行库。请在接下来打开的微软安装窗口中完成安装，然后本机助手会继续。');
  const locked=JSON.parse(await readFile(path.join(root,'native/runtime-lock.json'),'utf8')).find(row=>row.name==='vc_redist.x64.exe');
  if(!locked||!locked.url.startsWith('https://download.visualstudio.microsoft.com/'))throw Error('缺少微软运行库的固定下载信息');
  const response=await fetch(locked.url,{credentials:'omit',signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('微软运行库下载失败，请联网后重新安装');
  const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==locked.sha256)throw Error('微软运行库下载校验未通过');
  const directory=path.join(root,'.cache/prerequisites');await mkdir(directory,{recursive:true});const installer=path.join(directory,'vc_redist.x64.exe');await writeFile(installer,bytes);
  // Keep Microsoft's normal interactive installer: the user sees its terms and
  // any Windows elevation request. No quiet acceptance, reboot or policy change.
  try{await run(installer,['/install','/norestart'],{windowsHide:false});}catch(error){if(![3010,1638].includes(error.code))throw Error('微软运行库安装未完成，请完成安装后再试');}
  await probe();
}
export async function install({destination=path.join(process.env.LOCALAPPDATA||'','TemuExactMatch'),autostart=true,showSetup=true}={}){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('此安装包用于64位Windows10/11');
  const root=path.resolve(destination);if(root===path.parse(root).root||root===path.resolve(process.env.LOCALAPPDATA||'.')||root===path.resolve(source))throw Error('安装目录无效');
  const manifest=await verifyDistribution(source),marker=path.join(root,'.local-install.json');
  if(existsSync(root)){
    const previous=JSON.parse(await readFile(marker,'utf8').catch(()=>{throw Error('目标目录不属于本机助手，未覆盖现有文件');}));
    if(previous.appId!==APP_ID)throw Error('目标目录不属于本机助手');
    const oldControl=path.join(root,'scripts/service-control.mjs');if(existsSync(oldControl))await run(path.join(root,'runtime/node/node.exe'),[oldControl,'stop'],{windowsHide:true});
  }
  await mkdir(root,{recursive:true});
  // Only verified files are copied. Local caches and browser memory are never
  // read, exported or removed; publish the extension manifest last.
  for(const row of [...manifest.files].sort((a,b)=>Number(a.path==='extension/manifest.json')-Number(b.path==='extension/manifest.json'))){const file=inside(root,row.path);await mkdir(path.dirname(file),{recursive:true});await copyFile(inside(source,row.path),file);}
  await copyFile(path.join(source,'native-package.json'),path.join(root,'native-package.json'));
  await writeFile(marker,JSON.stringify({appId:APP_ID,version:manifest.version,installedAt:new Date().toISOString()},null,2));
  const node=path.join(root,'runtime/node/node.exe');
  await ensureRuntime(root,node);
  if(autostart)await run(node,[path.join(root,'scripts/service-autostart.mjs'),'enable'],{windowsHide:true});
  await run(node,[path.join(root,'scripts/service-control.mjs'),'start',...(showSetup?['--open-setup']:[])],{windowsHide:true,timeout:120000,maxBuffer:100000});
  let ready=false;for(let attempt=0;attempt<120;attempt++){const health=await readHealth();if(health?.model?.state==='error')throw Error('后台模型准备失败：'+health.model.message);if(health?.version===manifest.version&&health.model?.state==='ready'){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!ready)throw Error('后台模型准备尚未完成，请查看本机助手状态页面');
  console.log('安装完成。浏览器扩展加载目录：'+path.join(root,'extension'));
  return root;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{const target=process.argv.find(arg=>arg.startsWith('--destination='))?.slice(14);await install({...(target?{destination:target}:{}),autostart:!process.argv.includes('--no-autostart'),showSetup:!process.argv.includes('--no-open')});}catch(error){console.error('安装未完成：'+error.message);process.exitCode=1;}
}
