const initial=()=>({ok:true,engine:'browser',runtime:'browser-wasm-v1',configured:true,model:{state:'loading',message:'正在准备浏览器内置识别…',progress:null}});
export class BrowserEngineClient{
  constructor({createWorker=()=>new Worker(new URL('./engine-worker.js',import.meta.url))}={}){this.createWorker=createWorker;this.worker=null;this.pending=new Map();this.nextId=0;this.state=initial();}
  ensure(){
    if(this.worker)return;
    const worker=this.createWorker();this.worker=worker;
    this.firstState=new Promise(resolve=>{this.resolveState=resolve;});
    worker.onmessage=({data})=>{
      if(this.worker!==worker)return;
      if(data.type==='state'){this.state=data.health;this.resolveState?.();this.resolveState=null;return;}
      const job=this.pending.get(data.id);if(!job)return;this.pending.delete(data.id);job.clean();
      if(data.error)job.reject(new Error(data.error));else job.resolve(data.result);
    };
    worker.onerror=event=>{this.reset(new Error('浏览器识别初始化失败，请重开侧栏重试：'+(event.message||'未知原因')));this.state={...initial(),model:{state:'error',message:'浏览器识别引擎未能启动，请重开侧栏重试。',progress:null}};};
    worker.postMessage({id:0,path:'/health'});
  }
  async request(path,body,{signal}={}){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(path==='/prepare'&&this.state.model?.state==='error')this.reset();
    this.ensure();
    if(path==='/health'){if(this.resolveState)await Promise.race([this.firstState,new Promise(resolve=>setTimeout(resolve,150))]);return structuredClone(this.state);}
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;
      const abort=()=>this.reset(new DOMException('Aborted','AbortError'));
      this.pending.set(id,{resolve,reject,clean:()=>signal?.removeEventListener('abort',abort)});
      signal?.addEventListener('abort',abort,{once:true});
      try{this.worker.postMessage({id,path,body});}catch(error){this.pending.delete(id);signal?.removeEventListener('abort',abort);reject(error);}
    });
  }
  reset(error=new DOMException('Closed','AbortError')){this.worker?.terminate();this.worker=null;this.resolveState?.();this.resolveState=null;for(const job of this.pending.values()){job.clean();job.reject(error);}this.pending.clear();this.state=initial();}
}
let client;
export const engineRequest=(path,body,options)=>(client??=new BrowserEngineClient()).request(path,body,options);
export const closeEngine=()=>client?.reset();
