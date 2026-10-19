export const ENGINE_REVISION='native-512-fp32-v1';
const base='http://127.0.0.1:43187';
export class LocalEngineClient{
  constructor({fetchService=fetch}={}){this.fetchService=fetchService.bind(globalThis);this.controllers=new Set();}
  async request(path,body,{signal}={}){
    if(!['/health','/prepare','/image','/compare','/prefetch'].includes(path))throw Error('本机识别操作无效');
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const controller=new AbortController(),abort=()=>controller.abort();this.controllers.add(controller);signal?.addEventListener('abort',abort,{once:true});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},path==='/health'?4000:180000);
    try{
      const response=await this.fetchService(base+path,{method:body===undefined?'GET':'POST',credentials:'omit',redirect:'error',headers:{'X-Temu-Client':'exact-match',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
      const result=await response.json();if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');if(response.ok===false||result.ok===false)throw Error(result.error||'本机识别未完成');
      if(path==='/health'&&result.engineRevision!==ENGINE_REVISION)throw Error('本机识别初始化失败：本机助手版本需要更新，请运行新版安装程序');
      return result;
    }catch(error){
      if(error.name==='AbortError'){if(!timedOut)throw error;throw Error('本机识别响应超时，请重试');}
      if(error instanceof TypeError)throw Error('本机识别初始化失败：未连接到本机助手，请先安装配套程序；安装后会在登录电脑时自动启动');
      throw error;
    }finally{clearTimeout(timer);this.controllers.delete(controller);signal?.removeEventListener('abort',abort);}
  }
  close(){for(const controller of this.controllers)controller.abort();this.controllers.clear();}
}
let client;
export const engineRequest=(path,body,options)=>(client??=new LocalEngineClient()).request(path,body,options);
export const closeEngine=()=>{client?.close();client=null;};
