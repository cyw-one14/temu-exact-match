import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {prepareModels} from '../scripts/prepare-models.mjs';
const bytes=Buffer.from('explicit model provisioning test fixture');
const entry={path:'models/test/model.onnx',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:'https://huggingface.co/test/resolve/fixed/model.onnx'};
test('native provisioning downloads only verified models and reuses existing bytes without a browser runtime',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'temu-model-test-'));let calls=0;
  try{
    const options={directory,lock:{files:[entry]},fetchModel:async()=>{calls++;return new Response(bytes);}};
    await prepareModels(options);await prepareModels(options);assert.equal(calls,1);assert.deepEqual(await readFile(path.join(directory,entry.path)),bytes);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('corrupt downloads and escaped paths never become installed model files',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'temu-model-invalid-'));
  try{
    await assert.rejects(prepareModels({directory,lock:{files:[entry]},fetchModel:async()=>new Response('corrupt')}),/digest mismatch/);
    await assert.rejects(readFile(path.join(directory,entry.path)),{code:'ENOENT'});
    await assert.rejects(prepareModels({directory,lock:{files:[{...entry,path:'models/../../outside'}]}}),/Unsafe/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
