import {createHash} from 'node:crypto';
import {SharedWork} from './parallel-work.mjs';

// Read-only intermediate tensors for identical model inputs, never verdicts.
// Keep in-flight calls together and bound completed tensors by both count/bytes.
export class FeatureOutputCache{
  constructor({capacity=64,maxBytes=32*1024*1024}={}){this.capacity=capacity;this.maxBytes=maxBytes;this.rows=new Map();this.bytes=0;this.shared=new SharedWork();}
  get(input,compute,{signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason);
    const key=createHash('sha256').update(input).digest('hex'),row=this.rows.get(key);
    if(row){this.rows.delete(key);this.rows.set(key,row);return Promise.resolve(row.value);}
    return this.shared.get(key,async signal=>{
      const value=await compute(signal);signal.throwIfAborted();
      const row={value,bytes:Object.values(value).reduce((sum,tensor)=>sum+(tensor?.data?.byteLength||0),0)};this.rows.set(key,row);
      this.bytes+=row.bytes;
      for(const [oldKey,oldRow]of this.rows){
        if(this.rows.size<=this.capacity&&this.bytes<=this.maxBytes)break;
        this.rows.delete(oldKey);this.bytes-=oldRow.bytes;
      }
      return value;
    },{signal});
  }
}
