import {readFile,writeFile,readdir,mkdir,copyFile,stat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createDeflateRaw} from 'node:zlib';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';
import './init-key.mjs';
import './prepare-browser-assets.mjs';
import './build-browser.mjs';
const root=new URL('../',import.meta.url);
for(const name of ['core','provider','prices','listing','title-match','collection'])await copyFile(new URL('shared/'+name+'.mjs',root),new URL('extension/'+name+'.mjs',root));
await mkdir(new URL('dist/',root),{recursive:true});
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const assets=JSON.parse(await readFile(new URL('extension/browser-assets.json',root)));
const listed=new Set(assets.files.map(file=>file.path));
const rootFiles=new Set(JSON.parse(await readFile(new URL('browser/package-files.json',root))));
async function walk(directory=''){
  const output=[];
  for(const entry of await readdir(new URL('extension/'+directory,root),{withFileTypes:true})){
    const name=directory+entry.name;
    if(entry.isSymbolicLink())throw Error('Refusing linked package path '+name);
    if(entry.isDirectory()){if(!['vendor/','models/','python/','licenses/'].some(prefix=>name+'/'===prefix||name.startsWith(prefix)))throw Error('Unexpected extension folder '+name);output.push(...await walk(name+'/'));}
    else if(entry.isFile()){
      if(name.includes('/')?!listed.has(name):!rootFiles.has(name))throw Error('Unlisted browser asset '+name);
      if(/(?:^|\/)(?:\.env|\.cache|node_modules|.*\.(?:pem|key|log))$/.test(name))throw Error('Unexpected private file '+name);
      output.push(name);
    }
  }
  return output.sort();
}
const files=await walk(),centrals=[];let offset=0;
const archive=new URL('dist/temu-exact-match-extension.zip',root),output=createWriteStream(archive);
let outputError;output.on('error',error=>{outputError=error;});
async function write(bytes){if(outputError)throw outputError;if(!output.write(bytes))await once(output,'drain');offset+=bytes.length;}
for(const name of files){
  const source=new URL('extension/'+name,root),filename=Buffer.from(name),start=offset;
  if((await stat(source)).size>=0xffffffff)throw Error('ZIP64 required');
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0808,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt16LE(filename.length,26);
  await write(local);await write(filename);
  let crc=0xffffffff,size=0,compressed=0;
  const inputCount=new Transform({transform(chunk,encoding,callback){size+=chunk.length;for(const value of chunk)crc=table[(crc^value)&255]^(crc>>>8);callback(null,chunk);}});
  const compressedCount=new Transform({transform(chunk,encoding,callback){compressed+=chunk.length;callback(null,chunk);}});
  const append=new Writable({write(chunk,encoding,callback){if(outputError)callback(outputError);else output.write(chunk,encoding,callback);}});
  await pipeline(createReadStream(source),inputCount,createDeflateRaw({level:6}),compressedCount,append);offset+=compressed;
  crc=(crc^0xffffffff)>>>0;
  const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(compressed,8);descriptor.writeUInt32LE(size,12);await write(descriptor);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0808,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed,20);central.writeUInt32LE(size,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(start,42);centrals.push(central,filename);
}
const directory=Buffer.concat(centrals),directoryStart=offset;await write(directory);
if(offset>=0xffffffff||files.length>65535)throw Error('ZIP64 required');
const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(directoryStart,16);await write(end);
output.end();await once(output,'close');if(outputError)throw outputError;
const version=JSON.parse(await readFile(new URL('package.json',root))).version;
await copyFile(archive,new URL('dist/temu-exact-match-'+version+'-browser.zip',root));
console.log('Created browser-only extension '+version+': '+files.length+' files, '+offset+' bytes.');
