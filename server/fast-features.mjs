import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {subjectDescriptor,instanceReference} from './subjects.mjs';
import {WorkQueue} from './parallel-work.mjs';

export const fastFeatureState={state:'idle',algorithm:'SIFT',message:'快速特征核验尚未启动'};
const portable=new URL('../runtime/python/python.exe',import.meta.url);
const python=process.env.TEMU_FEATURE_PYTHON||(existsSync(portable)?fileURLToPath(portable):fileURLToPath(new URL(process.platform==='win32'?'../.cache/feature-runtime/Scripts/python.exe':'../.cache/feature-runtime/bin/python',import.meta.url)));
let child,readyPromise,nextId=0;
const pending=new Map();
const featureQueue=new WorkQueue(1);
function fail(error){
  fastFeatureState.state='unavailable';fastFeatureState.message='快速特征核验不可用，使用原主体模型';
  for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}pending.clear();
}
export function prepareFastFeatures(){
  if(readyPromise)return readyPromise;
  readyPromise=(async()=>{
    await access(python);fastFeatureState.state='loading';
    return new Promise((resolve,reject)=>{
      let started=false;
      child=spawn(python,['-B','-u',fileURLToPath(new URL('./feature_worker.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
      const timeout=setTimeout(()=>{child.kill();reject(new Error('快速核验启动超时'));},10000);
      createInterface({input:child.stdout}).on('line',line=>{
        let data;try{data=JSON.parse(line);}catch{return;}
        if(data.ready){started=true;clearTimeout(timeout);fastFeatureState.state='ready';fastFeatureState.message='SIFT 快速特征核验已就绪';resolve();return;}
        const job=pending.get(data.id);if(!job)return;
        clearTimeout(job.timer);pending.delete(data.id);
        if(data.ok)job.resolve(data.comparison);else job.reject(new Error(data.error||'快速核验失败'));
      });
      child.stderr.on('data',()=>{});
      child.on('error',error=>{clearTimeout(timeout);fail(error);reject(error);});
      child.on('exit',()=>{clearTimeout(timeout);const error=new Error('快速核验进程已结束');fail(error);if(!started)reject(error);});
      child.stdin.on('error',error=>fail(error));
    });
  })().catch(error=>{fail(error);throw error;});
  return readyPromise;
}
export async function comparePreparedFeatures(template,candidate,options={}){
  return featureJob({algorithm:'SIFT',template:template.toString('base64'),candidate:candidate.toString('base64')},options);
}
export async function compareFocusedFeatures(template,candidate,options={}){
  return featureJob({operation:'focused-details',algorithm:'SIFT',template:template.cropped.toString('base64'),candidate:candidate.cropped.toString('base64'),templateAttention:template.attentionWeights,candidateAttention:candidate.attentionWeights},options);
}
export async function comparePreparedInstances(template,candidate,attention=null,options={}){
  return featureJob({operation:'instance-match',template:template.toString('base64'),candidate:candidate.toString('base64'),...(attention?{templateAttention:attention}:{})},options);
}
export async function compareReferenceShape(template,candidate,options={}){return featureJob({operation:'reference-shape',template:template.toString('base64'),candidate:candidate.toString('base64')},options);}
export async function comparePreparedOutlines(template,candidate,attention={},options={}){
  return featureJob({operation:'outline-match',template:template.toString('base64'),candidate:candidate.toString('base64'),...attention},options);
}
export async function instanceFeatureCompare(reference,candidate,referenceText='',options={}){
  options.signal?.throwIfAborted();
  await prepareFastFeatures();
  const descriptor=await subjectDescriptor(reference,options);
  if(!descriptor.valid)return {matched:false,reason:'参考主体不完整，无法核验商品实例'};
  const focused=await instanceReference(descriptor,referenceText,options);options.signal?.throwIfAborted();
  return comparePreparedInstances(descriptor.cropped,candidate,focused.attentionWeights,options);
}
async function featureJob(data,{signal}={}){
  signal?.throwIfAborted();
  await prepareFastFeatures();
  signal?.throwIfAborted();
  if(fastFeatureState.state!=='ready')throw new Error('快速特征核验不可用');
  return featureQueue.run(()=>{
    if(fastFeatureState.state!=='ready')throw new Error('快速特征核验不可用');
    return new Promise((resolve,reject)=>{
      const id=++nextId;
      const timer=setTimeout(()=>{child?.kill();fail(new Error('快速特征核验超时'));},15000);
      pending.set(id,{resolve,reject,timer});
      child.stdin.write(JSON.stringify({id,...data})+'\n');
    });
  },{signal}).then(value=>{signal?.throwIfAborted();return value;});
}
export async function fastFeatureCompare(reference,candidate,options={}){
  options.signal?.throwIfAborted();
  // Do not extract the reference for an unavailable optional runtime.
  await prepareFastFeatures();
  if(fastFeatureState.state!=='ready')throw new Error('快速特征核验不可用');
  const descriptor=await subjectDescriptor(reference,options);options.signal?.throwIfAborted();
  if(!descriptor.valid||!descriptor.cropped)return {matched:false,reason:'参考主体不完整，使用原主体模型'};
  return comparePreparedFeatures(descriptor.cropped,candidate,options);
}
export function closeFastFeatures(){child?.stdin.end();child?.kill();}
process.once('exit',()=>child?.kill());
