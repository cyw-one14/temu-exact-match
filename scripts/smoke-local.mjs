import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {localSearchPhrase,localCompare} from '../server/vision.mjs';
await mkdir(new URL('../test-output/',import.meta.url),{recursive:true});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/><rect x="190" y="132" width="132" height="290" rx="30" fill="#298dce"/><rect x="215" y="100" width="82" height="42" rx="8" fill="#20252a"/><path d="M205 172h100M205 232h100M205 292h100M205 352h100" stroke="#1a6d9f" stroke-width="8"/></svg>';
let buffer;
try{buffer=await readFile(new URL('../test-output/real-bottle.webp',import.meta.url));}catch{buffer=await sharp(Buffer.from(svg)).png().toBuffer();}
await writeFile(new URL('../test-output/reference.png',import.meta.url),buffer);
const started=Date.now();
const profile=await localSearchPhrase(buffer);
if(!profile.keywords.some(query=>/bottle/i.test(query)))throw new Error('The bottle fixture was misidentified: '+JSON.stringify(profile));
const pending=await localCompare(buffer,buffer,{},'Example product');
const specs={brand:'ExampleBrand',model:'A123',material:'silicone',dimensions:'500ml',quantity:'1pc'};
const complete=await localCompare(buffer,buffer,specs,'Brand: ExampleBrand; Model: A123; Material: silicone; Capacity: 500ml; Quantity: 1pc');
if(pending.status!=='pending')throw new Error('A duplicate image alone was treated as exact product identity');
if(complete.status!=='exact')throw new Error('Identical image and explicit matching specifications were not recognized');
console.log(JSON.stringify({seconds:(Date.now()-started)/1000,profile,pendingStatus:pending.status,completeStatus:complete.status}));
