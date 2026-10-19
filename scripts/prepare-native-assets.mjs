import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
export const nativeAssets=path.join(root,'.cache/native-assets');
export async function prepareNativeAssets(){
  const rows=JSON.parse(await readFile(path.join(root,'native/runtime-lock.json'),'utf8'));
  const cache=path.join(root,'.cache/native-distribution');await mkdir(cache,{recursive:true});
  const developmentPython=path.join(root,'.cache/feature-runtime/Scripts/python.exe');
  const python=process.env.TEMU_BUILD_PYTHON||(existsSync(developmentPython)?developmentPython:'python');
  for(const row of rows){
    if(row.name.endsWith('.exe'))continue; // Optional Microsoft prerequisite is downloaded only if missing at install time.
    const file=path.join(cache,row.name);let bytes;try{bytes=await readFile(file);}catch{}
    if(!bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256){
      const response=await fetch(row.url,{signal:AbortSignal.timeout(240000)});if(!response.ok)throw Error('Runtime download failed '+row.name);
      bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Runtime digest mismatch '+row.name);await writeFile(file,bytes);
    }
    const mode=row.name.startsWith('node-')?'node':row.name.endsWith('.whl')?'wheel':'python';
    const destination=path.join(nativeAssets,mode==='node'?'node':mode==='wheel'?'python/Lib/site-packages':'python');
    await mkdir(destination,{recursive:true});
    await run(python,[path.join(root,'scripts/extract-native.py'),file,destination,mode],{windowsHide:true});
  }
  await writeFile(path.join(nativeAssets,'python/python313._pth'),'python313.zip\n.\nLib\\site-packages\n..\\..\\server\nimport site\n');
  const result=await run(path.join(nativeAssets,'python/python.exe'),['-B','-c','import cv2,numpy; assert hasattr(cv2,"SIFT_create"); print(cv2.__version__,numpy.__version__)'],{windowsHide:true});
  console.log('Portable native image libraries:',result.stdout.trim());
}
if(process.argv[1]===fileURLToPath(import.meta.url))await prepareNativeAssets();
