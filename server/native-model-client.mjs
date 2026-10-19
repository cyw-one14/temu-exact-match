import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {serializeTensors,deserializeTensors} from './native-tensors.mjs';
import {nativeWorkers,nativeThreads} from './native-runtime.mjs';

// This pinned ORT 1.21 binding crashed during simultaneous Node Worker runs
// with "Cannot create a handle without a HandleScope". Isolate native lanes
// in child processes. Advanced IPC preserves typed arrays/BigInt without JSON.
export function createNativeProcess(entry=new URL('./native-model-worker.mjs',import.meta.url),threads=nativeThreads){
  const child=fork(fileURLToPath(entry),[],{serialization:'advanced',stdio:['ignore','ignore','inherit','ipc'],windowsHide:true,execArgv:[],env:{...process.env,TEMU_SUBJECT_THREADS:String(threads)}});
  const ref=child.ref.bind(child),unref=child.unref.bind(child);
  child.ref=()=>{ref();child.channel?.ref();};child.unref=()=>{unref();child.channel?.unref();};
  child.postMessage=message=>child.send(message,error=>{if(error)child.emit('error',error);});
  child.terminate=()=>{if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve();return new Promise(resolve=>{child.ref();child.once('exit',resolve);child.kill();});};
  return child;
}
export class NativeModelRuntime{
  constructor({createWorker=createNativeProcess,timeoutMs=120000}={}){this.createWorker=createWorker;this.timeoutMs=timeoutMs;this.worker=null;this.jobs=new Map();this.nextId=0;this.state={state:'idle',message:''};this.closed=false;}
  fail(error){this.state={state:'error',message:String(error.message||error).slice(0,200)};for(const job of this.jobs.values()){clearTimeout(job.timer);job.reject(error);}this.jobs.clear();this.worker?.unref();}
  request(operation,model,inputs,onProgress){
    if(this.closed||this.state.state==='error')return Promise.reject(Error(this.state.message||'原生计算线程已关闭'));
    if(!this.worker){
      try{
        this.worker=this.createWorker();this.worker.unref();
        this.worker.on('message',message=>{
          const job=this.jobs.get(message.id);if(!job)return;
          if(message.progress){job.onProgress?.(message.progress);return;}
          clearTimeout(job.timer);this.jobs.delete(message.id);if(!this.jobs.size)this.worker.unref();
          if(message.ok){this.state={state:'ready',message:''};job.resolve(message.value);}else job.reject(Error(message.error||'原生模型未完成'));
        });
        this.worker.on('error',error=>this.fail(error));this.worker.on('exit',code=>{if(!this.closed)this.fail(Error('原生计算线程退出（'+code+'）'));});
      }catch(error){this.fail(error);return Promise.reject(error);}
    }
    return new Promise((resolve,reject)=>{
      const id=++this.nextId,timer=setTimeout(()=>{this.fail(Error('原生模型运算超时，等待后台自动恢复'));this.worker.terminate();},this.timeoutMs);
      this.jobs.set(id,{resolve,reject,timer,onProgress});this.worker.ref();if(operation==='prepare')this.state={state:'loading',message:'正在加载固定本机模型'};
      try{this.worker.postMessage({id,operation,model,inputs});}catch(error){this.fail(error);}
    });
  }
  async model(name,Tensor,onProgress){
    await this.request('prepare',name,undefined,onProgress);
    return async inputs=>{
      const rows=serializeTensors(inputs);
      const output=await this.request('run',name,rows);
      return deserializeTensors(output,Tensor);
    };
  }
  close(){this.closed=true;this.fail(Error('原生计算线程已关闭'));return this.worker?.terminate();}
}
export class NativeModelPool{
  constructor({size=nativeWorkers,createRuntime=index=>new NativeModelRuntime({createWorker:()=>createNativeProcess(undefined,index===0?nativeThreads:1)})}={}){
    this.lanes=Array.from({length:size},(_,index)=>({runtime:createRuntime(index),busy:false}));this.waiting=[];this.closed=false;
  }
  get state(){const states=this.lanes.map(lane=>lane.runtime.state);return states.find(s=>s.state==='error')||states.find(s=>s.state==='loading')||{state:states.every(s=>s.state==='ready')?'ready':'idle'};}
  lane(model){const index={segment:0,features:1,attention:2}[model];if(index===undefined)throw Error('Unknown pinned native model');return this.lanes[Math.min(index,this.lanes.length-1)];}
  async model(name,Tensor,onProgress){
    // Stage pipeline: segmentation, DINO and attention can overlap for three
    // candidates while each model/reference is loaded and computed only once.
    await this.lane(name).runtime.request('prepare',name,undefined,onProgress);
    return async(inputs,{signal}={})=>deserializeTensors(await this.run(name,serializeTensors(inputs),{signal}),Tensor);
  }
  run(model,inputs,{signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason);
    if(!['segment','features','attention'].includes(model))return Promise.reject(Error('Unknown pinned native model'));
    if(this.closed||this.state.state==='error')return Promise.reject(Error(this.state.message||'原生计算线程已关闭'));
    return new Promise((resolve,reject)=>{
      const job={model,inputs,signal,resolve,reject};job.cleanup=()=>signal?.removeEventListener('abort',job.abort);
      job.abort=()=>{const index=this.waiting.indexOf(job);if(index>=0){this.waiting.splice(index,1);job.cleanup();reject(signal.reason);}};
      signal?.addEventListener('abort',job.abort,{once:true});this.waiting.push(job);this.drain();
    });
  }
  drain(){
    if(this.closed||this.state.state==='error'){
      for(const job of this.waiting.splice(0)){job.cleanup();job.reject(Error(this.state.message||'原生计算线程已关闭'));}return;
    }
    for(let i=0;i<this.waiting.length;){
      const job=this.waiting[i];
      const lane=this.lane(job.model);if(lane.busy){i++;continue;}
      this.waiting.splice(i,1);lane.busy=true;
      lane.runtime.request('run',job.model,job.inputs).then(value=>job.signal?.aborted?job.reject(job.signal.reason):job.resolve(value),job.reject).finally(()=>{job.cleanup();lane.busy=false;this.drain();});
    }
  }
  async close(){this.closed=true;this.drain();await Promise.all(this.lanes.map(lane=>lane.runtime.close()));}
}
let runtime;
export const prepareNativeModel=(name,Tensor,onProgress)=>(runtime??=new NativeModelPool()).model(name,Tensor,onProgress);
export const nativeModelHealth=()=>runtime?.state||{state:'idle'};
export const closeNativeModels=()=>runtime?.close();
