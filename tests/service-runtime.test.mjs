import test from 'node:test';
import assert from 'node:assert/strict';
import {isOwnedProcess,requireNodeVersion,extensionId} from '../scripts/service-runtime.mjs';
import {readFile} from 'node:fs/promises';
const root='D:\\00 Work\\temu-exact-match',serverPath=root+'\\server\\index.mjs';
const record={processId:123,projectRoot:root,serverPath};
test('service control can stop only the Node server recorded for this exact project',()=>{
  const process={ProcessId:123,Name:'node.exe',CommandLine:'"C:\\NodeJS\\node.exe" "'+serverPath+'"'};
  assert.equal(isOwnedProcess(record,process,root),true);
  assert.equal(isOwnedProcess(record,{...process,ProcessId:124},root),false);
  assert.equal(isOwnedProcess(record,{...process,Name:'msedge.exe'},root),false);
  assert.equal(isOwnedProcess(record,{...process,CommandLine:'node.exe other.mjs "'+serverPath+'"'},root),false);
  assert.equal(isOwnedProcess(record,{...process,CommandLine:'node.exe "'+serverPath+'.other"'},root),false);
  assert.equal(isOwnedProcess({...record,projectRoot:'D:\\other'},process,root),false);
});
test('the launcher rejects unsupported Node runtimes and pairs with the extension public key',async()=>{
  assert.throws(()=>requireNodeVersion('18.20.0'),/Node.js 22/);assert.doesNotThrow(()=>requireNodeVersion('24.21.0'));
  const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.equal(extensionId(manifest.key),'ofacjamiaffjahodlncfbcpekooecjno');
});

test('supervisor records must name the owned watchdog as the first Node argument',()=>{
  const watchdog=root+'\\scripts\\service-watchdog.mjs',owned={...record,role:'watchdog',serverPath:watchdog};
  const info={ProcessId:123,Name:'node.exe',CommandLine:'node.exe "'+watchdog+'"'};
  assert.equal(isOwnedProcess(owned,info,root),true);
  assert.equal(isOwnedProcess(owned,{...info,CommandLine:'node.exe other.mjs "'+watchdog+'"'},root),false);
  assert.equal(isOwnedProcess({...owned,role:'server'},info,root),false);
  assert.equal(isOwnedProcess(owned,{...info,ProcessId:124},root),false);
});
