import {Worker} from 'node:worker_threads';
import {serializeTensors,deserializeTensors} from './native-tensors.mjs';

// onnxruntime-node 1.21 schedules a synchronous native run on its JS thread.
// Keep that thread separate so HTTP health/cancellation remains responsive.
export class NativeModelRuntime{
  constructor({createWorker=()=>new Worker(new URL('./native-model-worker.mjs',import.meta.url),{name:'temu-native-models'}),timeoutMs=120000}={}){this.createWorker=createWorker;this.timeoutMs=timeoutMs;this.worker=null;this.jobs=new Map();this.nextId=0;this.state={state:'idle',message:''};this.closed=false;}
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
let runtime;
export const prepareNativeModel=(name,Tensor,onProgress)=>(runtime??=new NativeModelRuntime()).model(name,Tensor,onProgress);
export const nativeModelHealth=()=>runtime?.state||{state:'idle'};
export const closeNativeModels=()=>runtime?.close();
