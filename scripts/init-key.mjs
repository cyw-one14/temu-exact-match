import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const url=new URL('../extension/manifest.json',import.meta.url);
const manifest=JSON.parse(await readFile(url,'utf8'));
if(!manifest.key){
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'der'}});
  manifest.key=publicKey.toString('base64');
  await writeFile(url,JSON.stringify(manifest,null,2)+'\n');
}
const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
console.log('Extension ID: '+id);
