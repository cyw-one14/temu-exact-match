import test from 'node:test';
import assert from 'node:assert/strict';
import {colorAttention,ATTENTION_REVISION} from '../server/product-attention.mjs';
import {compareFocusedDescriptors} from '../server/subjects.mjs';

function scene(productColor=[130,80,45],handColor=[225,172,139]){
  const width=30,height=20,rgba=Buffer.alloc(width*height*4),human=Buffer.alloc(width*height),product=Buffer.alloc(width*height);
  for(let i=0;i<width*height;i++){const hand=i%width>=20,offset=i*4;rgba.set(hand?handColor:productColor,offset);rgba[offset+3]=255;human[i]=hand?220:40;product[i]=hand?20:220;}
  return {width,height,rgba,human,product};
}
test('color alone never ignores wood, beige products or semantic-protected wearable gloves; originals stay unchanged',()=>{
  for(const color of [[130,80,45],[225,172,139],[85,53,37]]){
    const input=scene(color,color),before=Buffer.from(input.rgba);
    const result=colorAttention(input.rgba,input.human,input.product,input.width,input.height);
    assert.deepEqual(input.rgba,before);assert.equal(result.summary.applied,false,'indistinguishable product/skin colors stay included');assert.ok(result.weights.every(value=>value===255));
  }
  const input=scene();input.human.fill(220);input.product.fill(240);
  assert.equal(colorAttention(input.rgba,input.human,input.product,input.width,input.height).summary.applied,false,'product evidence protects gloves even when hand semantics is high');
});
test('semantic and per-image color evidence lower only accompanying hand weights and preserve occluded/ambiguous product regions',()=>{
  const input=scene(),before=Buffer.from(input.rgba);
  const result=colorAttention(input.rgba,input.human,input.product,input.width,input.height);
  assert.equal(result.summary.applied,true);assert.equal(result.summary.reducedFraction,1/3);assert.deepEqual(input.rgba,before);
  for(let i=0;i<input.width*input.height;i++)assert.equal(result.weights[i],i%input.width>=20?26:255);
  const colorOnly=scene();colorOnly.human.fill(40);
  assert.equal(colorAttention(colorOnly.rgba,colorOnly.human,colorOnly.product,colorOnly.width,colorOnly.height).summary.applied,false);
});
function focused(){
  const patches=Array.from({length:12},(_,index)=>Array.from({length:12},(_,axis)=>Number(index===axis)));
  const positions=Array.from({length:12},(_,index)=>[(index%3)/2,Math.floor(index/3)/3]);
  return {valid:true,embedding:[1,0],patches,positions,colors:[1,0],focusMode:ATTENTION_REVISION};
}
test('focused evidence requires multiple product regions, geometry and color; hands/shared packaging cannot supply acceptance',()=>{
  const a=focused();assert.equal(compareFocusedDescriptors(a,a).matched,true);
  assert.equal(compareFocusedDescriptors(a,{...a,colors:[0,1]}).matched,false);
  assert.equal(compareFocusedDescriptors(a,{...a,patches:a.patches.slice(0,4),positions:a.positions.slice(0,4)}).matched,false);
  assert.equal(compareFocusedDescriptors(a,{...a,embedding:[0,1]}).matched,false);
  const concentrated={...a,positions:a.positions.map(([x,y])=>[x*.1,y*.1])};
  assert.equal(compareFocusedDescriptors(concentrated,concentrated).matched,false,'localized common packaging is insufficient');
  const scattered={...a,positions:a.positions.map((_,i)=>[(i*7%13)/12,(i*5%11)/10])};
  assert.equal(compareFocusedDescriptors(a,scattered).matched,false,'unrelated spatial detail layout stays pending');
  assert.equal(compareFocusedDescriptors(a,{...a,valid:false}).matched,false);
});
