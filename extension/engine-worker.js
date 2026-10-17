// All executable code, model weights and image libraries are packaged locally.
importScripts('./vendor/pyodide/pyodide.js','./browser-engine.bundle.js');
const runtime=TemuBrowserEngine;
const publish=()=>postMessage({type:'state',health:runtime.health()});
setInterval(publish,1000);
let queue=Promise.resolve();
onmessage=event=>{
  const {id,path,body}=event.data||{};
  if(!Number.isInteger(id))return;
  if(path==='/prefetch'){runtime.prefetch(body?.images||[]);postMessage({id,result:{ok:true}});return;}
  if(path==='/image'||path==='/compare')runtime.prefetch([body?.imageUrl]);
  const run=async()=>{try{const result=await runtime.request(path,body);postMessage({id,result});}catch(error){console.error('Browser image operation failed',error);postMessage({id,error:String(error?.message||error).slice(0,400)});}finally{publish();}};
  if(path==='/health'){publish();postMessage({id,result:runtime.health()});}
  else{queue=queue.then(run,run);}
};
runtime.prepare().catch(()=>{}).finally(publish);
publish();
