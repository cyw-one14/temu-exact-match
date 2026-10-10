import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const imageURL=new URL(process.argv[2]||'https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg?imageView2/2/w/800/q/70/format/avif');
assert.equal(imageURL.protocol,'https:');assert.equal(imageURL.hostname,'img.kwcdn.com');
const candidateURL=new URL(imageURL);candidateURL.search='imageView2/2/w/200/q/70/format/jpg';
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
const base='http://127.0.0.1:43187';
const health=await (await fetch(base+'/health')).json();assert.equal(health.engine,'local');
async function api(path,body){
  const response=await fetch(base+path,{method:'POST',headers:{Origin:'chrome-extension://'+id,'X-Temu-Client':'exact-match','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const data=await response.json();assert.ok(response.ok,data.error);return data;
}
const image=await api('/image',{imageUrl:imageURL.href});
const started=performance.now();
const data=await api('/compare',{referenceImage:image.dataUrl,referenceImageUrl:imageURL.href,imageUrl:candidateURL.href,referenceSpecs:{},candidateText:''});
console.log(JSON.stringify({samePhoto:data.comparison.samePhoto,pixelIdentical:data.comparison.pixelIdentical,assetVerified:data.comparison.assetVerified,imageSimilarity:data.comparison.imageSimilarity,status:data.comparison.status,subject:data.comparison.subject,elapsedMs:Math.round(performance.now()-started)},null,2));
assert.equal(data.comparison.subject,null);
assert.equal(data.comparison.samePhoto,true);
assert.equal(data.comparison.status,'visual-match');
console.log('同一图片可进入外观同款；未提供规格时不标为完整规格一致。');
