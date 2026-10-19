import test from 'node:test';
import assert from 'node:assert/strict';
import {decideProductMatch} from '../shared/core.mjs';
const reference={brand:'Acme',model:'A12',material:'silicone',dimensions:'500ml',quantity:'1pc'};
const listing='Brand: Other Brand; Model: B77; Material: wood; Capacity: 1L; Quantity: 2pcs';
const checks=Object.keys(reference).map(key=>({key,status:'different',candidateValue:'different page value',evidence:'listing text'}));

test('all page specification differences annotate but never veto a confirmed image subject',()=>{
  for(const image of [{visual:'same_photo'},{visual:'uncertain',subject:{matched:true}},{visual:'uncertain',fastMatch:{matched:true}}]){
    const result=decideProductMatch({...image,checks,differences:['Capacity: 500ml vs 1L','Model: A12 vs B77']},reference,listing);
    assert.equal(result.status,'visual-match');assert.equal(result.listingDifferences.length,5);
    assert.equal(result.packDifference.candidate,'2pcs');assert.deepEqual(result.differences,[]);
  }
});
test('text agreement cannot confirm an uncertain image and text conflict cannot exclude one',()=>{
  assert.equal(decideProductMatch({visual:'uncertain',checks,differences:['Different listed model']},reference,listing).status,'pending');
  assert.equal(decideProductMatch({visual:'uncertain',checks:[],differences:[]},{},'').status,'pending');
  assert.equal(decideProductMatch({visual:'different',checks:[],differences:['different tooth construction']},reference,listing).status,'different');
});
