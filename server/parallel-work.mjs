// Bounded work with cancellation before entry. Entered native graphs finish
// normally; their callers check cancellation before continuing the pipeline.
export class WorkQueue{
  constructor(limit){this.limit=limit;this.active=0;this.waiting=[];}
  run(task,{signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason);
    return new Promise((resolve,reject)=>{
      const row={task,signal,resolve,reject};
      row.abort=()=>{const i=this.waiting.indexOf(row);if(i>=0){this.waiting.splice(i,1);reject(signal.reason);}};
      signal?.addEventListener('abort',row.abort,{once:true});this.waiting.push(row);this.drain();
    });
  }
  drain(){
    while(this.active<this.limit&&this.waiting.length){
      const row=this.waiting.shift();row.signal?.removeEventListener('abort',row.abort);
      if(row.signal?.aborted){row.reject(row.signal.reason);continue;}
      this.active++;
      Promise.resolve().then(()=>{row.signal?.throwIfAborted();return row.task();}).then(row.resolve,row.reject).finally(()=>{this.active--;this.drain();});
    }
  }
}

// Same reference/crop is computed once. One cancelled panel cannot cancel
// another consumer. When the last consumer leaves, stop subsequent stages.
export class SharedWork{
  constructor(){this.pending=new Map();}
  get(key,compute,{signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason);
    let row=this.pending.get(key);
    if(!row||row.controller.signal.aborted){
      row={controller:new AbortController(),consumers:new Set()};this.pending.set(key,row);
      row.task=Promise.resolve().then(()=>{row.controller.signal.throwIfAborted();return compute(row.controller.signal);});
      const finish=()=>{if(this.pending.get(key)===row)this.pending.delete(key);};row.task.then(finish,finish);
    }
    return new Promise((resolve,reject)=>{
      const consumer={};row.consumers.add(consumer);
      const done=(callback,value)=>{if(!row.consumers.delete(consumer))return;signal?.removeEventListener('abort',abort);callback(value);};
      const abort=()=>{done(reject,signal.reason);if(!row.consumers.size)row.controller.abort();};
      signal?.addEventListener('abort',abort,{once:true});
      row.task.then(value=>done(resolve,value),error=>done(reject,error));
    });
  }
}
