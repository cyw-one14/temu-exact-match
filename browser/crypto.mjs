import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
export function createHash(name){
  if(name!=='sha256')throw Error('Unsupported image digest');
  const hash=sha256.create();
  return {update(value){hash.update(typeof value==='string'?new TextEncoder().encode(value):value);return this;},digest(encoding){const bytes=hash.digest();return encoding==='hex'?bytesToHex(bytes):Buffer.from(bytes);}};
}
