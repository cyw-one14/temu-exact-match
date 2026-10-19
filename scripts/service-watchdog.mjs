import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {projectRoot,readHealth,extensionId,terminateOwnedProcess} from './service-runtime.mjs';
import {WatchdogPolicy,restartDelay} from './watchdog-policy.mjs';

const manifest=JSON.parse(await readFile(path.join(projectRoot,'extension/manifest.json'),'utf8'));
const expected={version:manifest.version,extensionId:extensionId(manifest.key),installationId:createHash('sha256').update(projectRoot.toLowerCase()).digest('hex').slice(0,20)};
const serverPath=path.join(projectRoot,'server/index.mjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let failures=0;
for(;;){
  let child,monitor,checking=false;
  const startedAt=Date.now(),policy=new WatchdogPolicy({startedAt});
  try{
    child=spawn(process.execPath,[serverPath],{cwd:projectRoot,windowsHide:true,stdio:['pipe','inherit','inherit'],env:{...process.env,TEMU_WATCHDOG:'1'}});
    child.stdin.on('error',()=>{});
    const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error:error.message}));});
    monitor=setInterval(async()=>{
      if(checking||child.exitCode!==null||child.signalCode!==null)return;
      checking=true;
      try{
        const reason=policy.inspect(await readHealth(),expected);
        if(reason){console.error(new Date().toISOString()+' 自动恢复：'+reason);await terminateOwnedProcess({processId:child.pid,serverPath,projectRoot});}
      }catch(error){console.error('后台健康检查：'+error.message);}finally{checking=false;}
    },5000);
    const result=await exited;
    console.error(new Date().toISOString()+' 识别进程退出，准备自动恢复 '+JSON.stringify(result));
  }catch(error){console.error('后台自动恢复：'+error.message);}finally{clearInterval(monitor);}
  failures=Date.now()-startedAt>=60000?1:failures+1;
  await delay(restartDelay(failures));
}
