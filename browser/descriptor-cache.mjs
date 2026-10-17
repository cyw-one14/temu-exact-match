// The browser cache is independent of the Node preprocessing cache and manual memory.
const TTL=30*86400000;let database;
export function validDescriptor(value){
  if(value?.valid===false)return true;
  const vector=(array,size)=>Array.isArray(array)&&array.length===size&&array.every(Number.isFinite);
  return value?.valid===true&&vector(value.embedding,384)&&Array.isArray(value.patches)&&value.patches.length>=6&&value.patches.length<=256&&value.patches.every(patch=>vector(patch,384))&&vector(value.colors,64)&&value.colors.every(number=>number>=0&&number<=1)&&typeof value.cropped==='string'&&value.cropped.length<500000&&typeof value.preview==='string'&&value.preview.startsWith('data:image/png;base64,');
}
async function db(){if(!database)database=new Promise((resolve,reject)=>{const r=indexedDB.open('temu-browser-512-962e679-fp32-dino-c2bb04-canvas-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('descriptors',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return database;}
async function operation(mode,task){const store=(await db()).transaction('descriptors',mode).objectStore('descriptors');return new Promise((resolve,reject)=>{const r=task(store);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function descriptorCache(key,compute,{directory='subject-v1',validate=()=>true}={}){
  if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid descriptor cache key');
  const id=directory+'/'+key;
  try{const row=await operation('readonly',store=>store.get(id));if(row&&Number.isFinite(row.time)&&Date.now()-row.time>=0&&Date.now()-row.time<TTL&&validDescriptor(row.value)&&validate(row.value))return {...row.value,...(row.value.cropped?{cropped:Buffer.from(row.value.cropped,'base64')}:{})};}catch{}
  const value=await compute();
  try{await operation('readwrite',store=>store.put({key:id,time:Date.now(),value:{...value,...(value.cropped?{cropped:value.cropped.toString('base64')}:{})}}));const rows=await operation('readonly',store=>store.getAll());if(rows.length>256)for(const row of rows.sort((a,b)=>b.time-a.time).slice(256))await operation('readwrite',store=>store.delete(row.key));}catch{}
  return value;
}
