import test from 'node:test';
import assert from 'node:assert/strict';
import {localCompare} from '../server/vision.mjs';
import {compareSubjects,subjectState,prepareReferenceFeatures} from '../server/subjects.mjs';
import {fastFeatureCompare,instanceFeatureCompare,comparePreparedFeatures,comparePreparedInstances,comparePreparedOutlines,compareReferenceShape} from '../server/fast-features.mjs';
import {identifyAttention} from '../server/product-attention.mjs';

test('cancelled native work never decodes images or starts subject models',async()=>{
  const controller=new AbortController();controller.abort();const before=JSON.stringify(subjectState);
  await assert.rejects(localCompare(Buffer.from('invalid'),Buffer.from('invalid'),{},'',{signal:controller.signal,subjectMatching:true}),{name:'AbortError'});
  await assert.rejects(compareSubjects(Buffer.from('invalid'),Buffer.from('invalid'),{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(prepareReferenceFeatures(Buffer.from('invalid'),'',{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(fastFeatureCompare(Buffer.from('invalid'),Buffer.from('invalid'),{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(instanceFeatureCompare(Buffer.from('invalid'),Buffer.from('invalid'),'',{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(identifyAttention(Buffer.from('invalid'),'',{signal:controller.signal}),{name:'AbortError'});
  const invalid=Buffer.from('invalid'),options={signal:controller.signal};
  await assert.rejects(comparePreparedFeatures(invalid,invalid,options),{name:'AbortError'});
  await assert.rejects(comparePreparedInstances(invalid,invalid,null,options),{name:'AbortError'});
  await assert.rejects(comparePreparedOutlines(invalid,invalid,{},options),{name:'AbortError'});
  await assert.rejects(compareReferenceShape(invalid,invalid,options),{name:'AbortError'});
  assert.equal(JSON.stringify(subjectState),before);
});
