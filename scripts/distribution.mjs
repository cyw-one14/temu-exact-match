import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
export const APP_ID='temu-exact-match-local';
export function inside(root,relative){
  if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(part=>part==='..'||!part)||path.isAbsolute(relative))throw Error('Unsafe distribution path');
  const resolved=path.resolve(root,relative);if(!resolved.startsWith(path.resolve(root)+path.sep))throw Error('Distribution path escaped destination');return resolved;
}
export async function fileHash(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
export async function verifyDistribution(root){
  const manifest=JSON.parse(await readFile(path.join(root,'native-package.json'),'utf8'));
  if(manifest.appId!==APP_ID||!Array.isArray(manifest.files)||manifest.files.length>15000)throw Error('Not a TEMU local installer');
  const names=new Set();for(const row of manifest.files){
    const file=inside(root,row.path);if(names.has(row.path))throw Error('Duplicate distribution file');names.add(row.path);
    const metadata=await stat(file);if(!metadata.isFile()||metadata.size!==row.bytes||await fileHash(file)!==row.sha256)throw Error('Installer file verification failed: '+row.path);
  }
  for(const required of ['runtime/node/node.exe','runtime/python/python.exe','server/index.mjs','extension/manifest.json','scripts/service-control.mjs'])if(!names.has(required))throw Error('Incomplete installer '+required);
  return manifest;
}
