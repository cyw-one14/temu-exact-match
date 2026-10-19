import {readFile,writeFile,mkdir,rename,readdir,stat,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {NATIVE_REVISION,nativeDevice} from './native-runtime.mjs';

// Separate revision directory prevents reuse after any model/preprocessing change.
const root=process.env.TEMU_SUBJECT_CACHE_DIR||fileURLToPath(new URL('../.cache/subjects-'+NATIVE_REVISION+'-'+nativeDevice+'/',import.meta.url));
const TTL=30*86400000;
let writes=0;
function valid(value){
  if(value?.valid===false)return true;
  const finiteVector=(array,size)=>Array.isArray(array)&&array.length===size&&array.every(Number.isFinite);
  return value?.valid===true&&finiteVector(value.embedding,384)&&Array.isArray(value.patches)&&value.patches.length>=6&&value.patches.length<=256&&value.patches.every(patch=>finiteVector(patch,384))&&finiteVector(value.colors,64)&&value.colors.every(number=>number>=0&&number<=1)&&typeof value.cropped==='string'&&value.cropped.length<500000&&typeof value.preview==='string'&&value.preview.startsWith('data:image/png;base64,');
}
export async function descriptorCache(key,compute,{directory=root,validate=()=>true}={}){
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid descriptor cache key');
  const path=join(directory,key+'.json');
  if(process.env.TEMU_SUBJECT_CACHE!=='0')try{
    const info=await stat(path);
    if(info.size<1000000&&Date.now()-info.mtimeMs<TTL){
      const data=JSON.parse(await readFile(path,'utf8'));
      if(valid(data)&&validate(data))return {...data,...(data.cropped?{cropped:Buffer.from(data.cropped,'base64')}:{})};
    }
  }catch{/* Missing / corrupt cache is recomputed, never treated as a verdict. */}
  const value=await compute();
  if(process.env.TEMU_SUBJECT_CACHE==='0')return value;
  try{
    await mkdir(directory,{recursive:true});
    const temporary=path+'.'+process.pid+'.tmp';
    await writeFile(temporary,JSON.stringify({...value,...(value.cropped?{cropped:value.cropped.toString('base64')}:{})}));
    await rename(temporary,path);
    if(++writes%32===0){
      const names=(await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
      const records=await Promise.all(names.map(async name=>({name,time:(await stat(join(directory,name))).mtimeMs})));
      records.sort((a,b)=>b.time-a.time);
      for(const record of records.filter((item,index)=>index>=256||Date.now()-item.time>TTL))await unlink(join(directory,record.name));
    }
  }catch{/* Cache failure must not change the computed result. */}
  return value;
}
