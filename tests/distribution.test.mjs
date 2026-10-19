import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inside,fileHash,verifyDistribution,APP_ID} from '../scripts/distribution.mjs';

test('installer rejects escaped paths, duplicate entries and tampered files before installation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'temu-distribution-test-'));
  try{
    for(const value of ['../outside','a/../../outside','a\\..\\outside','/absolute','a//b',''])assert.throws(()=>inside(root,value));
    const files=[];
    for(const name of ['runtime/node/node.exe','runtime/python/python.exe','server/index.mjs','extension/manifest.json','scripts/service-control.mjs']){
      const file=inside(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'installer fixture');files.push({path:name,bytes:17,sha256:await fileHash(file)});
    }
    const save=rows=>writeFile(path.join(root,'native-package.json'),JSON.stringify({appId:APP_ID,files:rows}));
    await save(files);assert.equal((await verifyDistribution(root)).files.length,5);
    await save([...files,files[0]]);await assert.rejects(verifyDistribution(root),/Duplicate/);
    await save([...files,{...files[0],path:'../outside'}]);await assert.rejects(verifyDistribution(root),/Unsafe/);
    await save(files);await writeFile(inside(root,files[0].path),'changed content!!');await assert.rejects(verifyDistribution(root),/verification failed/);
    await save(files.slice(1));await assert.rejects(verifyDistribution(root),/Incomplete/);
  }finally{await rm(root,{recursive:true,force:true});}
});
