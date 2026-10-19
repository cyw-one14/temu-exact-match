// Arithmetic microbenchmark, not full inference or an accuracy evaluation.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {nearestPatches} from '../server/descriptor-match.mjs';
import {cosine} from '../server/subjects.mjs';
let seed=731;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32-.5;};
const vectors=count=>Array.from({length:count},()=>Array.from({length:384},random));
const left=vectors(64),right=vectors(80);
function baseline(left,right){
  const nearest=(from,to)=>from.map(token=>{let index=-1,score=-1;to.forEach((other,i)=>{const value=cosine(token,other);if(value>score){index=i;score=value;}});return {index,score};});
  return {ab:nearest(left,right),ba:nearest(right,left)};
}
assert.deepEqual(nearestPatches(left,right),baseline(left,right));
for(let i=0;i<5;i++){baseline(left,right);nearestPatches(left,right);}
const rounds=32,samples=[];
for(let sample=0;sample<5;sample++){
  const row={};for(const [name,fn]of sample%2?[['optimized',nearestPatches],['baseline',baseline]]:[['baseline',baseline],['optimized',nearestPatches]]){const start=performance.now();for(let i=0;i<rounds;i++)fn(left,right);row[name+'Ms']=Math.round((performance.now()-start)*10)/10;}samples.push(row);
}
console.log(JSON.stringify({scope:'Node arithmetic only, 64x80 patches of 384 values; not 50 product inference',roundsPerSample:rounds,samples},null,2));
