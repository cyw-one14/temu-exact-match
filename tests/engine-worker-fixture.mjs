// Browser transport double only. Existing panel scenarios keep their network
// fixtures, but production code contains no localhost fallback.
export function installEngineWorkerFixture(){
  globalThis.Worker=class{
    constructor(){this.controllers=new Set();this.closed=false;}
    postMessage({id,path,body}){
      const controller=new AbortController();this.controllers.add(controller);
      Promise.resolve().then(async()=>{
        const response=await fetch('http://127.0.0.1:43187'+path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
        const result=await response.json();if(response.ok===false||result.ok===false)throw Error(result.error||'TEST request failure');
        if(!this.closed){if(path==='/health')this.onmessage?.({data:{type:'state',health:result}});if(id)this.onmessage?.({data:{id,result}});}
      }).catch(error=>{if(!this.closed){if(error instanceof TypeError)this.onerror?.({message:error.message});else this.onmessage?.({data:{id,error:error.message}});}}).finally(()=>this.controllers.delete(controller));
    }
    terminate(){this.closed=true;for(const controller of this.controllers)controller.abort();this.controllers.clear();}
  };
}
