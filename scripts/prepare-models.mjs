import {readFile,writeFile,mkdir,stat,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inside,fileHash} from './distribution.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function prepareModels({directory=path.join(root,'native'),lock,fetchModel=fetch}={}){
  lock??=JSON.parse(await readFile(path.join(root,'native/model-lock.json'),'utf8'));
  const download=fetchModel.bind(globalThis);
  for(const row of lock.files){
    if(!row.path.startsWith('models/')||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isInteger(row.bytes)||row.bytes<=0)throw Error('Invalid pinned model manifest');
    const target=inside(directory,row.path);
    try{if((await stat(target)).size===row.bytes&&await fileHash(target)===row.sha256)continue;}catch{}
    const url=new URL(row.source);if(url.protocol!=='https:'||url.hostname!=='huggingface.co')throw Error('Unexpected model source');
    console.log('Prepare pinned model:',row.path);
    const response=await download(url,{credentials:'omit',signal:AbortSignal.timeout(240000)});if(!response.ok)throw Error('Model download failed '+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Pinned model digest mismatch '+row.path);
    await mkdir(path.dirname(target),{recursive:true});const temporary=target+'.'+process.pid+'.tmp';await writeFile(temporary,bytes);await rename(temporary,target);
  }
  console.log('Pinned native models ready:',lock.files.length,'files');
}
if(process.argv[1]===fileURLToPath(import.meta.url))await prepareModels();
