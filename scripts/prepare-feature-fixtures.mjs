import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {subjectDescriptor} from '../server/subjects.mjs';
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
const directory=new URL('../.cache/subject-validation/',import.meta.url);await mkdir(directory,{recursive:true});
for(const [name,imageUrl]of [['toothpaste','https://img.kwcdn.com/product/open/44ccfb56032749bcaa0bc9830cace2c8-goods.jpeg?imageView2/2/w/800/q/70/format/avif']]){
  const response=await fetch('http://127.0.0.1:43187/image',{method:'POST',headers:{Origin:'chrome-extension://'+id,'X-Temu-Client':'exact-match','Content-Type':'application/json'},body:JSON.stringify({imageUrl})});
  const value=await response.json();if(!response.ok)throw new Error(value.error);
  const buffer=Buffer.from(value.dataUrl.split(',')[1],'base64');await writeFile(new URL(name+'-original.png',directory),buffer);
  const start=performance.now(),descriptor=await subjectDescriptor(buffer);if(!descriptor.valid)throw new Error('Reference subject invalid');
  await writeFile(new URL(name+'-subject.png',directory),descriptor.cropped);console.log(JSON.stringify({name,subjectExtractMs:Math.round(performance.now()-start)}));
}
