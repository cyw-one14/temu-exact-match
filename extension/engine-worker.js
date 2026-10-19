// All executable code, model weights and image libraries are packaged locally.
importScripts('./vendor/pyodide/pyodide.js','./browser-engine.bundle.js');
const runtime=TemuBrowserEngine;
const publish=()=>postMessage({type:'state',health:runtime.health()});
setInterval(publish,1000);
let queue=Promise.resolve();
const imageJobs=[];let activeImages=0;
function drainImages(){while(activeImages<3&&imageJobs.length){activeImages++;imageJobs.shift()().finally(()=>{activeImages--;drainImages();});}}
onmessage=event=>{
  const {id,path,body}=event.data||{};
  if(!Number.isInteger(id))return;
  if(path==='/prefetch'){runtime.prefetch(body?.images||[]);postMessage({id,result:{ok:true}});return;}
  if(path==='/image'||path==='/compare')runtime.prefetch([body?.imageUrl]);
  const run=async()=>{try{const result=await runtime.request(path,body);postMessage({id,result});}catch(error){console.error('Browser image operation failed',error);postMessage({id,error:String(error?.message||error).slice(0,400)});}finally{publish();}};
  if(path==='/health'){publish();postMessage({id,result:runtime.health()});}
  // Image I/O and pixel evidence have no shared model/Python state. A slow
  // download must not block another ready photo; deep inference stays serial.
  else if(path==='/image'||(path==='/compare'&&['image-priority','page-match','page-image'].includes(body?.phase))){imageJobs.push(run);drainImages();}
  else{queue=queue.then(run,run);}
};
runtime.prepare().catch(()=>{}).finally(publish);
publish();
