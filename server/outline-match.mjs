import {createHash} from 'node:crypto';
import {subjectDescriptor,instanceReference} from './subjects.mjs';
import {comparePreparedOutlines} from './fast-features.mjs';
const cache=new Map();

export async function compareForegroundOutlines(reference,candidate,options={}){
  const [a,b]=await Promise.all([subjectDescriptor(reference),subjectDescriptor(candidate)]);
  if(!a.valid||!b.valid)return {revision:'subject-outline-v1',valid:false,matched:false,reason:'主体分割不完整，无法比较轮廓'};
  // Reuse the same cached product attention and human-region safeguard as
  // complete-instance review. These weights never rewrite the original mask.
  const focusedA=await instanceReference(a,options.referenceText||''),focusedB=await instanceReference(b,options.candidateText||'');
  const key=createHash('sha256').update('subject-outline-v1').update(a.cropped).update(b.cropped).update(focusedA.attentionWeights).update(focusedB.attentionWeights).digest('hex');
  if(cache.has(key))return cache.get(key);
  const result={...await comparePreparedOutlines(a.cropped,b.cropped,{templateAttention:focusedA.attentionWeights,candidateAttention:focusedB.attentionWeights}),attention:{reference:focusedA.attention,candidate:focusedB.attention}};
  if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
