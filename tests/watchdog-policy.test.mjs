import test from 'node:test';
import assert from 'node:assert/strict';
import {WatchdogPolicy,restartDelay} from '../scripts/watchdog-policy.mjs';
const expected={version:'test',extensionId:'test-id',installationId:'test-root'};
const health=state=>({ok:true,...expected,model:{state}});
test('transient misses and normal model preparation do not restart a healthy service',()=>{
  const policy=new WatchdogPolicy({startedAt:0});
  assert.equal(policy.inspect(null,expected,1000),null);assert.equal(policy.inspect(null,expected,6000),null);
  assert.equal(policy.inspect(health('loading'),expected,10000),null);
  assert.equal(policy.inspect(null,expected,15000),null);assert.equal(policy.inspect(health('ready'),expected,20000),null);
  assert.equal(policy.failures,0);
});
test('persistent missing health, module errors and stuck loading trigger bounded recovery',()=>{
  for(const sample of [null,health('error'),health('loading'),{...health('ready'),installationId:'someone-else'}]){
    const policy=new WatchdogPolicy({startedAt:0});
    assert.equal(policy.inspect(sample,expected,180001),null);assert.equal(policy.inspect(sample,expected,185001),null);
    assert.ok(policy.inspect(sample,expected,190001));
  }
  assert.deepEqual([1,2,3,4,5,6,50].map(restartDelay),[1000,3000,10000,30000,60000,60000,60000]);
});
