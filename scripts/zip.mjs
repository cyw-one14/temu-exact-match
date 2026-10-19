import {createReadStream,createWriteStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createDeflateRaw} from 'node:zlib';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';
import path from 'node:path';
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export async function writeZip(root,files,archive){
  const output=createWriteStream(archive),centrals=[];let offset=0,outputError;output.on('error',error=>{outputError=error;});
  async function write(bytes){if(outputError)throw outputError;if(!output.write(bytes))await once(output,'drain');offset+=bytes.length;}
  for(const name of files){
    const source=path.join(root,name),filename=Buffer.from(name),start=offset;
    if((await stat(source)).size>=0xffffffff)throw Error('ZIP64 required');
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0808,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt16LE(filename.length,26);await write(local);await write(filename);
    let crc=0xffffffff,size=0,compressed=0;
    const count=new Transform({transform(chunk,encoding,callback){size+=chunk.length;for(const value of chunk)crc=table[(crc^value)&255]^(crc>>>8);callback(null,chunk);}});
    const compressedCount=new Transform({transform(chunk,encoding,callback){compressed+=chunk.length;callback(null,chunk);}});
    await pipeline(createReadStream(source),count,createDeflateRaw({level:6}),compressedCount,new Writable({write(chunk,encoding,callback){if(outputError)callback(outputError);else output.write(chunk,encoding,callback);}}));offset+=compressed;crc=(crc^0xffffffff)>>>0;
    const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(compressed,8);descriptor.writeUInt32LE(size,12);await write(descriptor);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0808,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed,20);central.writeUInt32LE(size,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(start,42);centrals.push(central,filename);
  }
  const directory=Buffer.concat(centrals),start=offset;await write(directory);if(offset>=0xffffffff||files.length>65535)throw Error('ZIP64 required');
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(start,16);await write(end);output.end();await once(output,'close');if(outputError)throw outputError;
  return offset;
}
