import {readFile,readdir,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import '../scripts/init-key.mjs';
const root=new URL('../',import.meta.url);
await copyFile(new URL('shared/core.mjs',root),new URL('extension/core.mjs',root));
await copyFile(new URL('shared/provider.mjs',root),new URL('extension/provider.mjs',root));
await copyFile(new URL('shared/prices.mjs',root),new URL('extension/prices.mjs',root));
await copyFile(new URL('shared/listing.mjs',root),new URL('extension/listing.mjs',root));
await copyFile(new URL('shared/title-match.mjs',root),new URL('extension/title-match.mjs',root));
await mkdir(new URL('dist/',root),{recursive:true});
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?(0xedb88320^(n>>>1)):(n>>>1);return n>>>0;});
function crc32(buffer){let crc=0xffffffff;for(const value of buffer)crc=table[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const locals=[],centrals=[];let offset=0;const files=await readdir(new URL('extension/',root));
for(const name of files){
  const data=await readFile(new URL('extension/'+name,root));const compressed=deflateRawSync(data);const filename=Buffer.from(name);const crc=crc32(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  local.writeUInt16LE(33,12);
  locals.push(local,filename,compressed);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  central.writeUInt16LE(33,14);
  centrals.push(central,filename);offset+=local.length+filename.length+compressed.length;
}
const directory=Buffer.concat(centrals);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await writeFile(new URL('dist/temu-exact-match-extension.zip',root),Buffer.concat([...locals,directory,end]));
console.log('Created dist/temu-exact-match-extension.zip ('+files.length+' files).');
