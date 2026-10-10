import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
const base='http://127.0.0.1:43187';
const health=await(await fetch(base+'/health')).json();assert.equal(health.fastFeatures.state,'ready');
const rows=[];
for(const [name,path]of [['glove','fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg'],['toothpaste','open/44ccfb56032749bcaa0bc9830cace2c8-goods.jpeg']]){
  const imageUrl='https://img.kwcdn.com/product/'+path;
  const headers={Origin:'chrome-extension://'+id,'X-Temu-Client':'exact-match','Content-Type':'application/json'};
  const image=await(await fetch(base+'/image',{method:'POST',headers,body:JSON.stringify({imageUrl:imageUrl+'?imageView2/2/w/800/q/70/format/avif'})})).json();
  const start=performance.now();
  // Uploaded/unknown-URL reference: deliberately no same-resource URL evidence.
  const response=await fetch(base+'/compare',{method:'POST',headers,body:JSON.stringify({phase:'subject-review',referenceImage:image.dataUrl,imageUrl:imageUrl+'?imageView2/2/w/400/q/70/format/jpg',referenceSpecs:{},candidateText:''}),signal:AbortSignal.timeout(180000)});
  const data=await response.json();assert.ok(response.ok,data.error);
  const row={name,status:data.comparison.status,samePhoto:data.comparison.samePhoto,fastMatch:data.comparison.fastMatch,usedCandidateSubjectModel:Boolean(data.comparison.subject),elapsedMs:Math.round(performance.now()-start)};
  rows.push(row);console.log(JSON.stringify(row));
  assert.equal(row.samePhoto,false);assert.equal(row.status,'visual-match');
}
assert.ok(rows.some(row=>row.fastMatch?.matched&&!row.usedCandidateSubjectModel));
await writeFile(new URL('../.cache/subject-validation/fast-api-report.json',import.meta.url),JSON.stringify(rows,null,2));
