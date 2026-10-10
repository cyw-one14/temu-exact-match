import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {comparePreparedSubjects,compareDescriptors,describePreparedSubject} from '../server/subjects.mjs';
import {attentionState,ATTENTION_REVISION,productRegionHint} from '../server/product-attention.mjs';
import {closeFastFeatures} from '../server/fast-features.mjs';
const directory=new URL('../.cache/subjects-biref-de15b22-dino-c2bb04-1024-224-v1/',import.meta.url);
const load=async key=>{const value=JSON.parse(await readFile(new URL(key+'.json',directory),'utf8'));return {...value,cropped:Buffer.from(value.cropped,'base64')};};
const reference=await load('69467bb21a470d388b2d259a48ac86b0e9c4c63f148c58b3511293b39caf6671');
const candidate=await load('0bbdf41a6b2f4b12519844add14461ba7968ece9afbe1508703ee359b2359701');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex'),before=[hash(reference.cropped),hash(candidate.cropped)];
const context={referenceText:'Natural sandalwood wide tooth comb',candidateText:'Natural Comb Wide Tooth Hairdressing Comb Gua Sha Comb Scalp Massage Hair Comb'};
const results=[];
for(const name of ['actual-comb-first','actual-comb-cached']){
  const start=performance.now(),result=await comparePreparedSubjects(reference,candidate,context);
  const {referencePreview,candidatePreview,...record}=result;
  results.push({name,elapsedMs:Math.round(performance.now()-start),...record});console.log(JSON.stringify(results.at(-1)));
  assert.equal(result.attention.status,'applied');assert.equal(result.matched,false,'current real pair still lacks identifying detail evidence');
}
assert.deepEqual([hash(reference.cropped),hash(candidate.cropped)],before);
const woodProbes=[];
for(const [name,descriptor,text,rectangles]of [
  ['reference',reference,context.referenceText,[[133,67,155,119],[108,130,145,151],[39,137,51,174]]],
  ['candidate',candidate,context.candidateText,[[94,65,115,111],[70,176,89,187]]]
]){
  const key=createHash('sha256').update(ATTENTION_REVISION+':'+productRegionHint(text)).update(descriptor.cropped).digest('hex');
  const cached=JSON.parse(await readFile(new URL('../.cache/subjects-product-attention-v1/'+key+'.json',import.meta.url),'utf8'));
  const weights=Buffer.from(cached.attentionWeights,'base64'),rgba=await sharp(descriptor.cropped).ensureAlpha().raw().toBuffer();
  let total=0,reduced=0;
  for(const [x0,y0,x1,y1]of rectangles)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*224+x;if(rgba[i*4+3]>=160){total++;if(weights[i]<204)reduced++;}}
  woodProbes.push({name,total,reduced});assert.equal(reduced,0,'visible wood interior probes must retain their comparison weight');
}
const self=await comparePreparedSubjects(candidate,candidate,context);
assert.equal(self.attention.applied,true);assert.equal(self.matched,true,'focused layer can confirm a fully corresponding visible product');
{const {referencePreview,candidatePreview,...record}=self;results.push({name:'comb-self-focused-positive',...record});}
for(const name of ['glove-subject','toothpaste-subject']){
  const image=await readFile(new URL('../.cache/subject-validation/'+name+'.png',import.meta.url));
  const base=await describePreparedSubject(image),start=performance.now();
  const result=await comparePreparedSubjects(base,base,{referenceText:name,candidateText:name});
  assert.equal(result.attention.applied,false,'gloves/squeezer must not be reduced as accompanying humans');assert.equal(result.matched,true);
  const {referencePreview,candidatePreview,...record}=result;results.push({name,elapsedMs:Math.round(performance.now()-start),...record});console.log(JSON.stringify(results.at(-1)));
}
// Same hand context with an altered product must never be accepted by attention.
const altered=await sharp(candidate.cropped).modulate({hue:120}).png().toBuffer();
const changed=await describePreparedSubject(altered);
const result=await comparePreparedSubjects(reference,changed,context);assert.equal(result.matched,false);
const {referencePreview,candidatePreview,...record}=result;results.push({name:'changed-comb-color',...record});
const patch=await sharp({create:{width:21,height:46,channels:3,background:'#fff'}}).png().toBuffer();
const edited=await sharp(candidate.cropped).composite([{input:patch,left:94,top:65}]).png().toBuffer();
const editedDescriptor=await describePreparedSubject(edited),editedResult=await comparePreparedSubjects(candidate,editedDescriptor,context);
assert.equal(editedResult.matched,false,'shared hands may not override a changed visible wooden product region');
{const {referencePreview,candidatePreview,...record}=editedResult;results.push({name:'comb-changed-product-shared-hands',...record});}
await writeFile(new URL('../.cache/subject-validation/product-attention-production.json',import.meta.url),JSON.stringify({attentionState,originalsUnchanged:true,woodProbes,originalComparison:compareDescriptors(reference,candidate),results},null,2));
console.log(JSON.stringify({attentionState,originalsUnchanged:true,checks:'passed'}));
closeFastFeatures();
