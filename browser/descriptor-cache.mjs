// The browser cache is independent of the Node preprocessing cache and manual memory.
const TTL=30*86400000;let database;
export function validDescriptor(value){
  if(value?.valid===false)return true;
  const vector=(array,size)=>Array.isArray(array)&&array.length===size&&array.every(Number.isFinite);
  return value?.valid===true&&vector(value.embedding,384)&&Array.isArray(value.patches)&&value.patches.length>=6&&value.patches.length<=256&&value.patches.every(patch=>vector(patch,384))&&vector(value.colors,64)&&value.colors.every(number=>number>=0&&number<=1)&&typeof value.cropped==='string'&&value.cropped.length<500000&&typeof value.preview==='string'&&value.preview.startsWith('data:image/png;base64,');
}
async function db(){if(!database)database=new Promise((resolve,reject)=>{let abandoned=false;const r=indexedDB.open('temu-browser-512-962e679-fp32-dino-c2bb04-canvas-v1',2);r.onupgradeneeded=()=>{const store=r.result.objectStoreNames.contains('descriptors')?r.transaction.objectStore('descriptors'):r.result.createObjectStore('descriptors',{keyPath:'key'});if(!store.indexNames.contains('time'))store.createIndex('time','time');};r.onsuccess=()=>{if(abandoned){r.result.close();return;}r.result.onversionchange=()=>{r.result.close();database=null;};resolve(r.result);};r.onerror=()=>{if(abandoned)return;database=null;reject(r.error);};r.onblocked=()=>{abandoned=true;database=null;reject(Error('Descriptor cache upgrade blocked'));};});return database;}
async function operation(mode,task){const store=(await db()).transaction('descriptors',mode).objectStore('descriptors');return new Promise((resolve,reject)=>{const r=task(store);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
// The time index returns keys only: never clone every embedding just to prune.
export function pruneDescriptors(store,now=Date.now()){
  return new Promise((resolve,reject)=>{let kept=0;const r=store.index('time').openKeyCursor(null,'prev');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const cursor=r.result;if(!cursor){resolve();return;}if(kept++>=256||now-cursor.key>TTL)store.delete(cursor.primaryKey);cursor.continue();};});
}
export async function descriptorCache(key,compute,{directory='subject-v1',validate=()=>true}={}){
  if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid descriptor cache key');
  const id=directory+'/'+key;
  try{const row=await operation('readonly',store=>store.get(id));if(row&&Number.isFinite(row.time)&&Date.now()-row.time>=0&&Date.now()-row.time<TTL&&validDescriptor(row.value)&&validate(row.value))return {...row.value,...(row.value.cropped?{cropped:Buffer.from(row.value.cropped,'base64')}:{})};}catch{}
  const value=await compute();
  try{await operation('readwrite',store=>store.put({key:id,time:Date.now(),value:{...value,...(value.cropped?{cropped:value.cropped.toString('base64')}:{})}}));await pruneDescriptors((await db()).transaction('descriptors','readwrite').objectStore('descriptors'));}catch{}
  return value;
}
