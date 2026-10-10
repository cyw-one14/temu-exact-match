import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='http://127.0.0.1:43187';
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
const health=await(await fetch(base+'/health')).json();assert.equal(health.engine,'local');assert.equal(health.matchingPolicy,'product-attention-v11');
const report=[];
for(const [name,expected]of [['same-subject-new-background','visual-match'],['changed-color','pending']]){
  const buffer=await readFile(new URL('../.cache/subject-validation/'+name+'.png',import.meta.url));
  const started=Date.now();
  const response=await fetch(base+'/compare',{method:'POST',headers:{Origin:'chrome-extension://'+id,'Content-Type':'application/json','X-Temu-Client':'exact-match'},body:JSON.stringify({phase:'subject-review',referenceImage:'data:image/png;base64,'+buffer.toString('base64'),imageUrl:'https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg?imageView2/2/w/800/q/70/format/avif',referenceSpecs:{},candidateText:''}),signal:AbortSignal.timeout(180000)});
  const data=await response.json();assert.ok(response.ok,data.error);
  const {referencePreview,candidatePreview,...subject}=data.comparison.subject||{};
  const row={name,status:data.comparison.status,samePhoto:data.comparison.samePhoto,subject,elapsedMs:Date.now()-started};report.push(row);console.log(JSON.stringify(row));assert.equal(row.status,expected);
  // After inference populated the subject cache, initial page matching must
  // still behave exactly as the original image path, without cache influence.
  for(const phase of ['page-match','image-priority']){
    const pageResponse=await fetch(base+'/compare',{method:'POST',headers:{Origin:'chrome-extension://'+id,'Content-Type':'application/json','X-Temu-Client':'exact-match'},body:JSON.stringify({phase,referenceImage:'data:image/png;base64,'+buffer.toString('base64'),imageUrl:'https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg?imageView2/2/w/800/q/70/format/avif',referenceSpecs:{},candidateText:''})});
    const pageData=await pageResponse.json();assert.ok(pageResponse.ok,pageData.error);
    assert.equal(pageData.comparison.subject,null);assert.equal(pageData.comparison.matchStage,'page-image');
    if(phase==='page-match')assert.equal(pageData.comparison.status,'pending');
    else assert.equal(pageData.comparison.priorityScore,pageData.comparison.imageSimilarity);
  }
}
await writeFile(new URL('../.cache/subject-validation/api-report.json',import.meta.url),JSON.stringify(report,null,2));
