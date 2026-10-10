import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeImage} from '../server/images.mjs';

const url=new URL(process.argv[2]);
if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='kwcdn.com'||url.hostname.endsWith('.kwcdn.com')))throw new Error('Only public TEMU CDN product images');
const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
if(!response.ok)throw new Error('Image HTTP '+response.status);
const buffer=Buffer.from(await response.arrayBuffer());
const original=await sharp(buffer).metadata(),converted=await normalizeImage(buffer);
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
const local=await fetch('http://127.0.0.1:43187/image',{method:'POST',headers:{Origin:'chrome-extension://'+id,'X-Temu-Client':'exact-match','Content-Type':'application/json'},body:JSON.stringify({imageUrl:url.href}),signal:AbortSignal.timeout(30000)});
const value=await local.json();
let output;
if(local.ok){const normalized=await sharp(Buffer.from(value.dataUrl.split(',')[1],'base64')).metadata();output={format:normalized.format,width:normalized.width,height:normalized.height};}
console.log(JSON.stringify({remote:{http:response.status,mime:response.headers.get('content-type'),format:original.format,width:original.width,height:original.height,bytes:buffer.length},conversion:{format:'png',bytes:converted.buffer.length},service:{http:local.status,ok:value.ok,error:value.error,output}},null,2));
if(!local.ok)process.exitCode=1;
if(local.ok&&process.argv.includes('--profile')){
  const started=Date.now();
  const profileResponse=await fetch('http://127.0.0.1:43187/profile',{method:'POST',headers:{Origin:'chrome-extension://'+id,'X-Temu-Client':'exact-match','Content-Type':'application/json'},body:JSON.stringify({referenceImage:value.dataUrl,referenceSpecs:{}}),signal:AbortSignal.timeout(180000)});
  const result=await profileResponse.json();console.log(JSON.stringify({profile:{http:profileResponse.status,ok:result.ok,name:result.profile?.name,keywords:result.profile?.keywords,error:result.error,seconds:Math.round((Date.now()-started)/1000)}},null,2));
  if(!profileResponse.ok)process.exitCode=1;
}
