import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {pageCompare} from '../server/vision.mjs';
import {subjectState} from '../server/subjects.mjs';

const source=await sharp(Buffer.from('<svg width="64" height="64"><rect width="64" height="64" fill="white"/><rect x="8" y="8" width="36" height="40" fill="green"/></svg>')).png().toBuffer();
const changed=await sharp(source).modulate({hue:90}).png().toBuffer();

test('page-image matching uses original photo evidence without loading or consulting subject models',async()=>{
  const before=JSON.stringify(subjectState);
  const same=await pageCompare(source,source,{},'');
  assert.equal(same.status,'visual-match');assert.equal(same.samePhoto,true);
  assert.equal(same.subject,null);assert.equal(same.matchStage,'page-image');
  const different=await pageCompare(source,changed,{},'',{subjectMatching:true,subject:{matched:true}});
  assert.equal(different.status,'pending');assert.equal(different.subject,null);
  assert.equal(JSON.stringify(subjectState),before);
  const samePhotoPack=await pageCompare(source,source,{quantity:'3 pairs'},'Quantity: 1 pair');
  assert.equal(samePhotoPack.status,'visual-match');
  assert.equal(samePhotoPack.packDifference.candidate,'1 pair');
  const packConflict=await pageCompare(source,changed,{quantity:'3 pairs'},'Quantity: 1 pair');
  assert.equal(packConflict.status,'pending');
  const wording=await pageCompare(source,source,{material:'silicone'},'Material: Food Grade Silicone');
  assert.equal(wording.status,'visual-match');
  assert.equal(wording.listingDifferences.some(value=>value.key==='material'),true);
  const unit=await pageCompare(source,source,{dimensions:'18x12cm'},'Size: 18*12cm');
  assert.equal(unit.status,'visual-match');
  const differentText=await pageCompare(source,source,{model:'A12',dimensions:'500ml'},'Model: B77; Capacity: 1L');
  assert.equal(differentText.status,'visual-match');assert.equal(differentText.listingDifferences.length,2);
});
