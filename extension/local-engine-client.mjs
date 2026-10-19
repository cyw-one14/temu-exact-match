export const ENGINE_REVISION='native-512-fp32-v1';
const base='http://127.0.0.1:43187';
const listeners=new Set();
const publish=state=>{for(const listener of listeners)try{listener(state);}catch{}};
export const onEngineConnection=listener=>{listeners.add(listener);return ()=>listeners.delete(listener);};
const unavailable=()=>Object.assign(Error('本机识别初始化失败：后台暂未连接。请双击桌面“启动TEMU同款助手”，恢复后会继续核对。'),{serviceUnavailable:true});
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});
});
export class LocalEngineClient{
  constructor({fetchService=fetch,recoveryTimeoutMs=60000,retryDelayMs=1000,onConnectionState=publish}={}){this.fetchService=fetchService.bind(globalThis);this.controllers=new Set();this.recoveryTimeoutMs=recoveryTimeoutMs;this.retryDelayMs=retryDelayMs;this.onConnectionState=onConnectionState;}
  validate(path,result){if(path==='/health'&&result.engineRevision!==ENGINE_REVISION)throw Error('本机识别初始化失败：本机助手版本需要更新，请运行新版安装程序');}
  async fetchJSON(path,payload,signal){
    const response=await this.fetchService(base+path,{method:payload===undefined?'GET':'POST',credentials:'omit',redirect:'error',headers:{'X-Temu-Client':'exact-match',...(payload===undefined?{}:{'Content-Type':'application/json'})},...(payload===undefined?{}:{body:payload}),signal});
    const result=await response.json();signal.throwIfAborted();
    if(response.ok===false||result.ok===false)throw Error(result.error||'本机识别未完成');this.validate(path,result);return result;
  }
  async waitForRecovery(signal){
    const deadline=Date.now()+this.recoveryTimeoutMs;
    while(Date.now()<deadline){
      await pause(this.retryDelayMs,signal);
      try{
        const health=await this.fetchJSON('/health',undefined,AbortSignal.any([signal,AbortSignal.timeout(4000)]));
        signal.throwIfAborted();if(health.model?.state==='ready')return;
      }catch(error){signal.throwIfAborted();if(!(error instanceof TypeError)&&!['TimeoutError','AbortError'].includes(error.name))throw error;}
    }
    throw unavailable();
  }
  async request(path,body,{signal}={}){
    if(!['/health','/prepare','/image','/compare','/prefetch'].includes(path))throw Error('本机识别操作无效');
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const controller=new AbortController(),abort=()=>controller.abort();this.controllers.add(controller);signal?.addEventListener('abort',abort,{once:true});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},path==='/health'?4000:180000);
    try{
      const payload=body===undefined?undefined:JSON.stringify(body);
      try{return await this.fetchJSON(path,payload,controller.signal);}catch(error){
        controller.signal.throwIfAborted();
        if(!(error instanceof TypeError)||['/health','/prefetch'].includes(path))throw error;
        this.onConnectionState('recovering');
        await this.waitForRecovery(controller.signal);
        const result=await this.fetchJSON(path,payload,controller.signal);this.onConnectionState('ready');return result;
      }
    }catch(error){
      if(error.name==='AbortError'){if(!timedOut)throw error;throw Error('本机识别响应超时，请重试');}
      if(error instanceof TypeError)throw unavailable();
      throw error;
    }finally{clearTimeout(timer);this.controllers.delete(controller);signal?.removeEventListener('abort',abort);}
  }
  close(){for(const controller of this.controllers)controller.abort();this.controllers.clear();}
}
let client;
export const engineRequest=(path,body,options)=>(client??=new LocalEngineClient()).request(path,body,options);
export const closeEngine=()=>{client?.close();client=null;};
