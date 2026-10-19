import test from 'node:test';
import assert from 'node:assert/strict';
import {localCompare} from '../server/vision.mjs';
import {compareSubjects,subjectState} from '../server/subjects.mjs';

test('cancelled native work never decodes images or starts subject models',async()=>{
  const controller=new AbortController();controller.abort();const before=JSON.stringify(subjectState);
  await assert.rejects(localCompare(Buffer.from('invalid'),Buffer.from('invalid'),{},'',{signal:controller.signal,subjectMatching:true}),{name:'AbortError'});
  await assert.rejects(compareSubjects(Buffer.from('invalid'),Buffer.from('invalid'),{signal:controller.signal}),{name:'AbortError'});
  assert.equal(JSON.stringify(subjectState),before);
});
