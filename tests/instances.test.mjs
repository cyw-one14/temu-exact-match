import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import sharp from 'sharp';
import {comparePreparedInstances,compareReferenceShape,closeFastFeatures} from '../server/fast-features.mjs';
import {decideProductMatch} from '../shared/core.mjs';
let installed=true;try{await access(new URL('../.cache/feature-runtime/Scripts/python.exe',import.meta.url));}catch{installed=false;}
test.after(closeFastFeatures);
test('complete repeated product units match independently of count; partial branding, wrong colors and altered product details do not',{skip:!installed},async()=>{
  const gloves=await readFile(new URL('./fixtures/features/glove-subject.png',import.meta.url));
  assert.equal((await compareReferenceShape(gloves,gloves)).compatible,true);
  const macro=await sharp(gloves).extract({left:90,top:70,width:35,height:35}).resize(224,224).png().toBuffer();assert.equal((await compareReferenceShape(gloves,macro)).compatible,false,'a closeup is not a complete reference subject');
  const small=await sharp(gloves).resize(130,130).png().toBuffer();
  const scene=await sharp({create:{width:460,height:460,channels:3,background:'#fff'}}).composite(Array.from({length:9},(_,i)=>({input:small,left:(i%3)*150+10,top:Math.floor(i/3)*150+10}))).jpeg({quality:90}).toBuffer();
  const positive=await comparePreparedInstances(gloves,scene);assert.equal(positive.matched,true,JSON.stringify(positive));assert.ok(positive.inliers>=24);assert.ok(positive.subjectCoverage>=.30);
  const decision=decideProductMatch({visual:'uncertain',instanceMatch:positive,checks:[]},{quantity:'3 pairs'},'Quantity: 18 pairs');assert.equal(decision.status,'visual-match');assert.equal(decision.packDifference.candidate,'18 pairs');
  const changed=await sharp(scene).modulate({hue:160}).toBuffer();assert.equal((await comparePreparedInstances(gloves,changed)).matched,false);
  const partial=await sharp({create:{width:400,height:400,channels:3,background:'#fff'}}).composite([{input:await sharp(gloves).extract({left:35,top:35,width:50,height:50}).flatten({background:'#fff'}).png().toBuffer(),left:80,top:80}]).png().toBuffer();assert.equal((await comparePreparedInstances(gloves,partial)).matched,false);
  const tooth=await readFile(new URL('./fixtures/features/toothpaste-subject.png',import.meta.url)),wrong=await readFile(new URL('./fixtures/features/toothpaste-changed-detail.png',import.meta.url));
  assert.equal((await comparePreparedInstances(tooth,wrong)).matched,false,'shared packaging must not replace the complete product details');
  await assert.rejects(comparePreparedInstances(Buffer.from('bad image'),scene));assert.equal((await comparePreparedInstances(gloves,scene)).matched,true);
});
