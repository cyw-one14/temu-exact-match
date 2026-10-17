import {officialImage} from './provider.mjs';

const validId=value=>typeof value==='string'&&/^\d{6,25}$/.test(value);
export const validReferenceKey=value=>typeof value==='string'&&/^(?:goods:\d{6,25}|image-(?:sha256|url):[a-f0-9]{64})$/.test(value);
const validCandidateKey=value=>typeof value==='string'&&/^(?:temu|provider)-visible:\d{6,25}$/.test(value);
export function memoryStorageKey(referenceKey){return validReferenceKey(referenceKey)?'temuManual:v1:'+referenceKey:'';}
export function candidateMemoryKey(item){const source=item?.salesSource||'temu-visible';return validId(item?.id)&&['temu-visible','provider-visible'].includes(source)?source+':'+item.id:'';}
async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');}
export async function referenceMemoryKey(state){
  // Product identity survives a gallery-image, title, price or tracking change.
  if(validId(state.selection?.productId))return 'goods:'+state.selection.productId;
  if(validReferenceKey(state.manualReferenceKey))return state.manualReferenceKey;
  const raw=state.selection?.imageUrl||state.referenceImage;
  const url=officialImage(raw);if(url)return 'image-url:'+await digest(new TextEncoder().encode(url));
  const encoded=typeof raw==='string'&&/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if(encoded){const binary=atob(encoded[1]);return 'image-sha256:'+await digest(Uint8Array.from(binary,value=>value.charCodeAt(0)));}
  return '';
}
export function memoryRecord(value,referenceKey){
  const entries={};
  if(value?.schema===1&&value.referenceKey===referenceKey&&Number.isSafeInteger(value.revision)&&value.revision>=0){
    for(const [key,entry]of Object.entries(value.entries||{}))if(validCandidateKey(key)&&entry?.source==='user'&&['same','different','automatic'].includes(entry.decision)&&typeof entry.updatedAt==='string'&&Number.isFinite(Date.parse(entry.updatedAt)))entries[key]={decision:entry.decision,source:'user',updatedAt:entry.updatedAt};
    return {schema:1,referenceKey,revision:value.revision,entries};
  }
  return {schema:1,referenceKey,revision:0,entries};
}

// The extension worker is the single writer, including across windows/panels.
// Read the newest bucket inside the queue; never replace it with a panel cache.
export class ManualMemoryStore{
  constructor(storage){this.storage=storage;this.tail=Promise.resolve();}
  update({referenceKey,entries,onlyMissing=false}){
    if(!validReferenceKey(referenceKey)||!Array.isArray(entries)||!entries.length||entries.length>100||entries.some(entry=>!validCandidateKey(entry?.candidateKey)||!['same','different','automatic'].includes(entry.decision)))return Promise.reject(new Error('人工分类缺少可靠的商品标识'));
    const operation=this.tail.then(async()=>{
      const key=memoryStorageKey(referenceKey),saved=await this.storage.get(key),record=memoryRecord(saved[key],referenceKey);
      let changed=false;
      for(const entry of entries){
        if(onlyMissing&&record.entries[entry.candidateKey])continue;
        record.entries[entry.candidateKey]={source:'user',decision:entry.decision,updatedAt:onlyMissing&&typeof entry.updatedAt==='string'&&Number.isFinite(Date.parse(entry.updatedAt))?new Date(entry.updatedAt).toISOString():new Date().toISOString()};changed=true;
      }
      if(changed){record.revision++;await this.storage.set({[key]:record});}
      // Keep an explicit automatic decision so an old session cannot re-import
      // a correction the user has already cancelled. No automatic expiration.
      return record;
    });
    this.tail=operation.catch(()=>{});return operation;
  }
}
