import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,unlink,rmdir,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {descriptorCache} from '../server/descriptor-cache.mjs';

test('persistent features avoid repeated inference and malformed cache cannot create a match',async()=>{
  const root=fileURLToPath(new URL('../.cache/',import.meta.url));await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,'descriptor-test-'));
  const key='a'.repeat(64);let calls=0;
  const value={valid:true,embedding:Array(384).fill(.25),patches:Array.from({length:6},()=>Array(384).fill(.5)),colors:Array(64).fill(1/64),cropped:Buffer.from('test crop'),preview:'data:image/png;base64,dGVzdA=='};
  try{
    const first=await descriptorCache(key,async()=>{calls++;return value;},{directory});
    const second=await descriptorCache(key,async()=>{throw new Error('cache must skip inference');},{directory});
    assert.equal(calls,1);assert.deepEqual(first,second);
    await writeFile(join(directory,key+'.json'),'{"valid":true,"embedding":[0]}');
    await descriptorCache(key,async()=>{calls++;return value;},{directory});assert.equal(calls,2);
    await descriptorCache(key,async()=>{calls++;return {...value,attentionRevision:'new'};},{directory,validate:data=>data.attentionRevision==='new'});assert.equal(calls,3,'additional attention schema checks reject a stale ordinary descriptor');
    await assert.rejects(descriptorCache('../unsafe',async()=>value,{directory}),/Invalid/);
  }finally{for(const name of await readdir(directory))await unlink(join(directory,name));await rmdir(directory);}
});
