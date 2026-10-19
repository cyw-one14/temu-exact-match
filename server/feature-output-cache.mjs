import {createHash} from 'node:crypto';

// Read-only intermediate tensors for identical model inputs, never verdicts.
// Keep in-flight calls together and bound completed tensors by both count/bytes.
export class FeatureOutputCache{
  constructor({capacity=64,maxBytes=32*1024*1024}={}){this.capacity=capacity;this.maxBytes=maxBytes;this.rows=new Map();this.bytes=0;}
  get(input,compute){
    const key=createHash('sha256').update(input).digest('hex');let row=this.rows.get(key);
    if(row){this.rows.delete(key);this.rows.set(key,row);return row.task;}
    row={bytes:0,pending:true};this.rows.set(key,row);
    row.task=Promise.resolve().then(compute).then(value=>{
      row.pending=false;
      row.bytes=Object.values(value).reduce((sum,tensor)=>sum+(tensor?.data?.byteLength||0),0);
      this.bytes+=row.bytes;
      for(const [oldKey,oldRow]of this.rows){
        if(this.rows.size<=this.capacity&&this.bytes<=this.maxBytes)break;
        if(!oldRow.pending){this.rows.delete(oldKey);this.bytes-=oldRow.bytes;}
      }
      return value;
    },error=>{this.rows.delete(key);throw error;});
    return row.task;
  }
}
