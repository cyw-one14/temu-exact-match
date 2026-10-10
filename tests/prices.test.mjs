import test from 'node:test';
import assert from 'node:assert/strict';
import {priceObservation} from '../shared/prices.mjs';

test('page price ranges and conditional amounts retain their meaning instead of pretending to be one checkout price',()=>{
  const range=priceObservation('$3.76 – $4.85',{market:'us'});assert.equal(range.kind,'range');assert.equal(range.low,3.76);assert.equal(range.high,4.85);assert.equal(range.skuBound,false);
  assert.equal(priceObservation('预估 $3.76',{market:'us'}).kind,'conditional');
  assert.equal(priceObservation('from $3.76',{market:'us'}).kind,'starting');
  assert.equal(priceObservation('$3.76 $4.85',{market:'us'}).kind,'ambiguous');
  assert.equal(priceObservation('$5.99',{market:'unverified'}).currency,'');
  assert.equal(priceObservation('USD 5.99').currency,'USD');
  assert.equal(priceObservation('USD 3.76 – USD 4.85').kind,'range');
  assert.equal(priceObservation('').low,null);
});
