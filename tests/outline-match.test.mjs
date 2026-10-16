import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {comparePreparedOutlines,closeFastFeatures} from '../server/fast-features.mjs';
const path='M48 190 L45 98 L57 98 L60 55 L72 55 L75 94 L78 30 L91 30 L94 93 L101 43 L114 45 L111 111 L137 93 L151 105 L133 150 L120 190 Z';
const make=async(content,view='0 0 224 224')=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224" viewBox="'+view+'">'+content+'</svg>')).png().toBuffer();
const template=await make('<path fill="green" d="'+path+'"/>');
test.after(closeFastFeatures);

test('identical and similar outlines match independently of color, texture, rotation, mirror and uniform scale',async()=>{
  const color=await make('<path fill="blue" d="'+path+'"/><circle cx="88" cy="130" r="12" fill="yellow"/>');
  for(const candidate of [color,await sharp(template).rotate(12,{background:'#ffffff00'}).png().toBuffer(),await sharp(template).flop().rotate(90,{background:'#ffffff00'}).png().toBuffer(),await sharp(template).resize(233,224,{fit:'fill'}).png().toBuffer()]){
    const result=await comparePreparedOutlines(template,candidate);
    assert.equal(result.valid,true);assert.equal(result.matched,true,JSON.stringify(result));assert.ok(result.iou>=.9&&result.boundaryCoverage>=.9);assert.equal(result.revision,'subject-outline-v1');
  }
});
test('a complete prominent unit in a repeated layout can match a single-unit candidate, but different silhouettes cannot',async()=>{
  const repeated=await make('<g fill="green"><path d="'+path+'"/><path transform="translate(180 0)" d="'+path+'"/></g>','0 0 404 224');
  const match=await comparePreparedOutlines(repeated,template);assert.equal(match.matched,true,JSON.stringify(match));assert.equal(match.components.reference,2);
  const other=await make('<circle cx="110" cy="110" r="70" fill="green"/>');
  assert.equal((await comparePreparedOutlines(template,other)).matched,false);
});
test('missing, empty and tiny segmentation masks never become an outline match; a bad request does not break the worker',async()=>{
  for(const candidate of [await sharp(template).flatten({background:'#fff'}).png().toBuffer(),await make(''),await make('<rect x="90" y="90" width="5" height="5" fill="green"/>')]){
    const result=await comparePreparedOutlines(template,candidate);assert.equal(result.valid,false);assert.equal(result.matched,false);
  }
  assert.equal((await comparePreparedOutlines(template,template)).matched,true);
});
test('product attention affects only comparison masks; ambiguous/empty attention cannot invent an outline or alter originals',async()=>{
  const original=createHash('sha256').update(template).digest('hex');
  const weights=Buffer.alloc(224*224,255).toString('base64');
  assert.equal((await comparePreparedOutlines(template,template,{templateAttention:weights,candidateAttention:weights})).matched,true);
  assert.equal((await comparePreparedOutlines(template,template,{candidateAttention:Buffer.alloc(224*224).toString('base64')})).valid,false);
  assert.equal(createHash('sha256').update(template).digest('hex'),original);
});
test('captured glove masks preserve their outline through a derived rotation and remain distinct from the toothpaste roller mask',async()=>{
  const glove=await readFile(new URL('./fixtures/features/glove-subject.png',import.meta.url));
  const rotated=await sharp(glove).rotate(12,{background:'#ffffff00'}).png().toBuffer();
  const toothpaste=await readFile(new URL('./fixtures/features/toothpaste-subject.png',import.meta.url));
  assert.equal((await comparePreparedOutlines(glove,rotated)).matched,true);
  assert.equal((await comparePreparedOutlines(glove,toothpaste)).matched,false);
});
