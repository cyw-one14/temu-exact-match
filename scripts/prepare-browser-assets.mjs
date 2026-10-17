import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const pyRoot=path.dirname(require.resolve('pyodide/package.json'));
const target=path.join(root,'extension','vendor','pyodide');
await mkdir(target,{recursive:true});
const lock=JSON.parse(await readFile(path.join(pyRoot,'pyodide-lock.json'),'utf8'));
const allowed=new Set();
for(const name of ['pyodide.js','pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']){allowed.add('vendor/pyodide/'+name);await copyFile(path.join(pyRoot,name),path.join(target,name));}
const packages=new Set();
function include(name){if(packages.has(name))return;const item=lock.packages[name];if(!item)throw Error('Missing Pyodide package '+name);packages.add(name);item.depends.forEach(include);}
include('opencv-python');
for(const name of packages){
  const item=lock.packages[name],destination=path.join(target,item.file_name);
  allowed.add('vendor/pyodide/'+item.file_name);
  let data;try{data=await readFile(destination);}catch{}
  if(!data||createHash('sha256').update(data).digest('hex')!==item.sha256){
    console.log('Prepare browser package:',name,item.version);
    const response=await fetch('https://cdn.jsdelivr.net/pyodide/v0.28.3/full/'+item.file_name,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error('Package download failed '+response.status);
    data=Buffer.from(await response.arrayBuffer());
    if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Package digest mismatch '+name);
    await writeFile(destination,data);
  }
}
console.log('Browser Python/OpenCV assets ready:',packages.size,'packages');
const transformRoot=path.resolve(path.dirname(require.resolve('@huggingface/transformers')),'..');
const ortRoot=path.dirname(require.resolve('onnxruntime-web',{paths:[transformRoot]}));
await mkdir(path.join(root,'extension/vendor/onnx'),{recursive:true});
const {readdir}=await import('node:fs/promises');
await mkdir(path.join(root,'extension/licenses'),{recursive:true});
for(const name of await readdir(path.join(root,'browser/licenses'))){allowed.add('licenses/'+name);await copyFile(path.join(root,'browser/licenses',name),path.join(root,'extension/licenses',name));}
for(const name of await readdir(ortRoot))if(/^ort-wasm-simd-threaded.*\.(?:mjs|wasm)$/.test(name)){allowed.add('vendor/onnx/'+name);await copyFile(path.join(ortRoot,name),path.join(root,'extension/vendor/onnx',name));}
await mkdir(path.join(root,'extension/python'),{recursive:true});
for(const name of ['feature_worker.py','instance_match.py','outline_match.py']){allowed.add('python/'+name);await copyFile(path.join(root,'server',name),path.join(root,'extension/python',name));}
allowed.add('python/feature_bridge.py');
await copyFile(path.join(root,'browser/feature_bridge.py'),path.join(root,'extension/python/feature_bridge.py'));
const {models,files:lockedFiles}=JSON.parse(await readFile(path.join(root,'browser/model-lock.json'),'utf8'));
const records=[];
for(const row of lockedFiles)allowed.add(row.path);
for(const model of models)for(const file of model.files){
  const destination=path.join(root,'extension/models',model.id,file),source=path.join(root,'.cache/models',model.id,model.revision,file);
  await mkdir(path.dirname(destination),{recursive:true});
  const expected=lockedFiles.find(row=>row.path==='models/'+model.id+'/'+file);
  const verified=async location=>{try{const bytes=await readFile(location);return bytes.length===expected.bytes&&createHash('sha256').update(bytes).digest('hex')===expected.sha256;}catch{return false;}};
  if(await verified(destination)){records.push(expected);continue;}
  try{if(!(await verified(source)))throw Object.assign(Error('Missing verified model cache'),{code:'ENOENT'});await copyFile(source,destination);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const response=await fetch('https://huggingface.co/'+model.id+'/resolve/'+model.revision+'/'+file,{signal:AbortSignal.timeout(240000)});if(!response.ok)throw Error('Missing model file '+model.id+'/'+file);await writeFile(destination,Buffer.from(await response.arrayBuffer()));
  }
  if(!(await verified(destination)))throw Error('Pinned model digest mismatch '+model.id+'/'+file);
  const bytes=await readFile(destination);records.push({path:'models/'+model.id+'/'+file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:'https://huggingface.co/'+model.id+'/resolve/'+model.revision+'/'+file});
}
const all=[];
async function inventory(directory){for(const entry of await readdir(path.join(root,'extension',directory),{withFileTypes:true})){const name=directory+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Linked browser asset');if(entry.isDirectory())await inventory(name);else{if(!allowed.has(name))throw Error('Unexpected generated asset '+name);const bytes=await readFile(path.join(root,'extension',name));all.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
for(const directory of ['models','vendor','python','licenses'])await inventory(directory);
await writeFile(path.join(root,'extension/browser-assets.json'),JSON.stringify({runtime:'browser-wasm-v1',pyodide:'0.28.3',models:records,files:all.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
console.log('Bundled pinned vision models:',records.length,'files');
