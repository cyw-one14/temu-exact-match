import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeImage} from '../server/images.mjs';
import {subjectDescriptor,compareDescriptors} from '../server/subjects.mjs';
const url='https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg?imageView2/2/w/800/q/70/format/avif';
const response=await fetch(url);if(!response.ok)throw new Error('Image HTTP '+response.status);
const input=await normalizeImage(Buffer.from(await response.arrayBuffer()));
const begin=Date.now();const a=await subjectDescriptor(input.buffer);
await mkdir(new URL('../.cache/subject-validation/',import.meta.url),{recursive:true});
if(a.cropped)await writeFile(new URL('../.cache/subject-validation/glove-subject.png',import.meta.url),a.cropped);
console.log(JSON.stringify({valid:a.valid,coverage:a.coverage,patches:a.patches?.length,dimensions:a.embedding?.length,elapsedMs:Date.now()-begin}));
if(!a.valid)throw new Error('Reference foreground extraction failed');
for(const [name,variant]of [
  ['same-subject-new-background',await sharp({create:{width:350,height:300,channels:3,background:'#adc9e5'}}).composite([{input:await sharp(a.cropped).resize(200,200).toBuffer(),left:80,top:55}]).png().toBuffer()],
  ['rotated-subject',await sharp(a.cropped).rotate(12,{background:'#ffffff00'}).flatten({background:'#eee'}).png().toBuffer()],
  ['changed-color',await sharp(a.cropped).modulate({hue:160}).flatten({background:'#fff'}).png().toBuffer()]
]){const started=Date.now(),b=await subjectDescriptor(variant),comparison=compareDescriptors(a,b);console.log(JSON.stringify({name,...comparison,elapsedMs:Date.now()-started}));assert.equal(comparison.matched,name!=='changed-color');await writeFile(new URL('../.cache/subject-validation/'+name+'.png',import.meta.url),variant);}
