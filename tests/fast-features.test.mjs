import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import sharp from 'sharp';
import {comparePreparedFeatures,compareFocusedFeatures,closeFastFeatures} from '../server/fast-features.mjs';
import {decideProductMatch} from '../shared/core.mjs';
let installed=true;try{await access(new URL('../.cache/feature-runtime/Scripts/python.exe',import.meta.url));}catch{installed=false;}
test.after(closeFastFeatures);
test('fast feature evidence keeps product matches with a pack-count notice and does not invent verified specs',()=>{
  const evidence={visual:'uncertain',samePhoto:false,fastMatch:{matched:true},checks:[],differences:[]};
  assert.equal(decideProductMatch(evidence,{},'').status,'visual-match');
  const pack=decideProductMatch(evidence,{quantity:'4pcs'},'Quantity: 12 Pack');
  assert.equal(pack.status,'visual-match');assert.equal(pack.packDifference.candidate,'12 Pack');
  assert.equal(decideProductMatch({...evidence,fastMatch:{matched:false}}, {},'').status,'pending');
});
test('resident SIFT worker confirms rotated/reencoded subjects but rejects color, changed structure and partial matches',{skip:!installed},async()=>{
  const template=await readFile(new URL('./fixtures/features/glove-subject.png',import.meta.url));
  const candidate=await sharp(template).flatten({background:'#fff'}).jpeg({quality:75}).toBuffer();
  const a=await comparePreparedFeatures(template,candidate);assert.equal(a.matched,true);assert.equal(a.algorithm,'SIFT');
  const focused={cropped:template,attentionWeights:Buffer.alloc(224*224,255).toString('base64')};
  assert.equal((await compareFocusedFeatures(focused,focused)).matched,true);
  await assert.rejects(compareFocusedFeatures({...focused,attentionWeights:'AA=='},focused),/invalid attention weights/);
  assert.equal((await compareFocusedFeatures(focused,focused)).matched,true,'malformed attention cannot break subsequent detail checks');
  const rotation=await readFile(new URL('./fixtures/features/rotated-subject.png',import.meta.url));
  assert.equal((await comparePreparedFeatures(template,rotation)).matched,true);
  for(const [mirror,rotation]of [[true,0],[false,90],[true,90],[true,180],[true,270]]){
    let variant=template;
    if(mirror)variant=await sharp(variant).flop().png().toBuffer();
    if(rotation)variant=await sharp(variant).rotate(rotation).png().toBuffer();
    variant=await sharp(variant).flatten({background:'#fff'}).jpeg({quality:80}).toBuffer();
    const result=await comparePreparedFeatures(template,variant);
    assert.equal(result.matched,true,JSON.stringify({mirror,rotation,result}));
    if(mirror)assert.equal(result.orientation.mirror,true);
  }
  const changed=await sharp(template).modulate({hue:160}).flatten({background:'#fff'}).png().toBuffer();
  assert.equal((await comparePreparedFeatures(template,changed)).matched,false);
  const patch=await sharp({create:{width:45,height:45,channels:3,background:'#fff'}}).png().toBuffer();
  const edited=await sharp(template).flatten({background:'#fff'}).composite([{input:patch,left:100,top:65}]).png().toBuffer();
  assert.equal((await comparePreparedFeatures(template,edited)).matched,false);
  const partial=await sharp({create:{width:224,height:224,channels:3,background:'#fff'}}).composite([{input:await sharp(template).extract({left:35,top:35,width:50,height:50}).flatten({background:'#fff'}).png().toBuffer(),left:35,top:35}]).png().toBuffer();
  assert.equal((await comparePreparedFeatures(template,partial)).matched,false);
  await assert.rejects(comparePreparedFeatures(Buffer.from('not an image'),candidate));
  assert.equal((await comparePreparedFeatures(template,candidate)).matched,true,'bad input does not break the worker');
  const toothpaste=await readFile(new URL('./fixtures/features/toothpaste-subject.png',import.meta.url));
  const compressed=await sharp(toothpaste).flatten({background:'#fff'}).jpeg({quality:75}).toBuffer();
  assert.equal((await comparePreparedFeatures(toothpaste,compressed)).matched,true);
  const changedDetail=await readFile(new URL('./fixtures/features/toothpaste-changed-detail.png',import.meta.url));
  const detail=await comparePreparedFeatures(toothpaste,changedDetail);
  assert.equal(detail.matched,false);assert.ok(detail.neutralDetailError>10,'shared packaging must not override a changed white holder');
});
