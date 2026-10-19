import {parentPort} from 'node:worker_threads';
import * as lib from '@huggingface/transformers';
import {configureNative,nativeDevice,sessionOptions} from './native-runtime.mjs';
import {SUBJECT_MODELS,ATTENTION_MODEL} from './native-model-specs.mjs';
import {serializeTensors,deserializeTensors} from './native-tensors.mjs';
configureNative(lib);
const definitions={segment:{...SUBJECT_MODELS.segment,type:lib.AutoModel,dtype:'fp32',device:nativeDevice},features:{...SUBJECT_MODELS.features,type:lib.AutoModel,dtype:'q8',device:'cpu'},attention:{...ATTENTION_MODEL,type:lib.CLIPSegForImageSegmentation,dtype:'q8',device:'cpu'}};
const models=new Map();let queue=Promise.resolve();
function prepare(name,id){
  if(!Object.hasOwn(definitions,name))throw Error('Unknown pinned native model');
  if(!models.has(name)){
    const spec=definitions[name];
    const task=spec.type.from_pretrained(spec.id,{revision:spec.revision,dtype:spec.dtype,device:spec.device,session_options:sessionOptions,progress_callback:event=>parentPort.postMessage({id,progress:{status:event.status,file:event.file,progress:event.progress}})});
    models.set(name,task);task.catch(()=>models.delete(name));
  }
  return models.get(name);
}
parentPort.on('message',message=>{
  const task=queue.then(async()=>{
    const model=await prepare(message.model,message.id);
    if(message.operation==='prepare')return null;
    if(message.operation!=='run')throw Error('Invalid native model operation');
    const inputs=deserializeTensors(message.inputs,lib.Tensor);
    const output=await model(inputs);
    return serializeTensors(output);
  });
  queue=task.catch(()=>{});
  task.then(value=>parentPort.postMessage({id:message.id,ok:true,value}),error=>{console.error('Native model '+message.model+' '+message.operation+':',error.stack);parentPort.postMessage({id:message.id,ok:false,error:String(error.message||error).slice(0,300)});});
});
