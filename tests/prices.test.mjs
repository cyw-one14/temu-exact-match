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

test('explicit Canadian and Australian prices retain their amounts and cannot inherit a US-market or declared USD label',()=>{
  for(const [raw,currency,low,high] of [['CA$3.77','CAD',3.77,3.77],['CAD 3.77 – CAD 5.30','CAD',3.77,5.30],['AU$4.99 – AU$6.25','AUD',4.99,6.25],['AUD 7.50','AUD',7.5,7.5]]){
    const price=priceObservation(raw,{market:'us',currency:'USD'});assert.equal(price.currency,currency);assert.equal(price.low,low);assert.equal(price.high,high);assert.equal(price.raw,raw);
  }
  assert.equal(priceObservation('€4.50',{currency:'USD'}).currency,'EUR');
});
