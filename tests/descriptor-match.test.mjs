import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestPatches} from '../server/descriptor-match.mjs';
import {cosine,compareDescriptors,compareFocusedDescriptors} from '../server/subjects.mjs';
// Baseline deliberately evaluates each direction independently, as before.
function baseline(left,right){
  const nearest=(from,to)=>from.map(token=>{let index=-1,score=-1;to.forEach((other,i)=>{const value=cosine(token,other);if(value>score){index=i;score=value;}});return {index,score};});
  return {ab:nearest(left,right),ba:nearest(right,left)};
}
test('shared cosine arithmetic is exactly equal to both original directional searches, including ties and zero vectors',()=>{
  let seed=731;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32-.5;};
  const vectors=count=>Array.from({length:count},()=>Array.from({length:384},random));
  const pairs=[[vectors(64),vectors(80)],[[[1,0],[1,0],[0,0],[-1,0]],[[1,0],[0,0],[-1,0]]],[[],[[1,0]]],[[[],[1],[0,0]],[[0],[1,2],[]]]];
  for(const score of [.86-Number.EPSILON,.86,.86+Number.EPSILON,.92,.94,.96])pairs.push([[[1,0]],[[score,Math.sqrt(1-score*score)]]]);
  for(const [left,right]of pairs)assert.deepEqual(nearestPatches(left,right),baseline(left,right));
});
test('arithmetic reuse preserves threshold boundaries and cannot confirm shared local details without coverage, color and geometry',()=>{
  const patches=Array.from({length:16},(_,i)=>Array.from({length:16},(_,j)=>Number(i===j)));
  const positions=patches.map((_,i)=>[(i%4)/3,Math.floor(i/4)/3]);
  const a={valid:true,embedding:[1,0],patches,colors:[1,0],positions,focusMode:'test'};
  assert.equal(compareDescriptors(a,a).matched,true);
  assert.equal(compareDescriptors(a,{...a,colors:[0,1]}).matched,false);
  assert.equal(compareDescriptors(a,{...a,embedding:[0,1]}).matched,false);
  assert.equal(compareDescriptors(a,{...a,patches:patches.map(()=>patches[0])}).matched,false);
  assert.equal(compareFocusedDescriptors(a,a).matched,false,'an invalid attention revision remains invalid');
});
