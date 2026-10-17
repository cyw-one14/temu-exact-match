import {subjectDescriptor,instanceReference} from '../server/subjects.mjs';
export const fastFeatureState={state:'idle',algorithm:'SIFT',message:'浏览器图像核验正在准备'};
let runtime;
export function prepareFastFeatures(){
  if(runtime)return runtime;
  fastFeatureState.state='loading';
  runtime=(async()=>{
    const base=new URL('./vendor/pyodide/',self.location.href).href;
    const py=await globalThis.loadPyodide({indexURL:base});
    await py.loadPackage('opencv-python');
    py.FS.mkdirTree('/temu');
    for(const name of ['feature_worker.py','instance_match.py','outline_match.py','feature_bridge.py']){
      const response=await fetch(new URL('./python/'+name,self.location.href));if(!response.ok)throw Error('缺少内置核验文件 '+name);
      py.FS.writeFile('/temu/'+name,await response.text());
    }
    py.runPython("import sys\nsys.path.insert(0, '/temu')\nfrom feature_bridge import browser_feature_job\nimport cv2\nassert hasattr(cv2, 'SIFT_create')");
    fastFeatureState.state='ready';fastFeatureState.message='浏览器 SIFT / 轮廓核验已就绪';
    return py;
  })().catch(error=>{runtime=null;fastFeatureState.state='unavailable';fastFeatureState.message='浏览器图像核验未就绪：'+error.message;throw error;});
  return runtime;
}
async function featureJob(data){const py=await prepareFastFeatures(),call=py.globals.get('browser_feature_job');try{return JSON.parse(call(JSON.stringify(data)));}finally{call.destroy();}}
export const comparePreparedFeatures=(template,candidate)=>featureJob({template:template.toString('base64'),candidate:candidate.toString('base64')});
export const compareFocusedFeatures=(template,candidate)=>featureJob({operation:'focused-details',template:template.cropped.toString('base64'),candidate:candidate.cropped.toString('base64'),templateAttention:template.attentionWeights,candidateAttention:candidate.attentionWeights});
export const comparePreparedInstances=(template,candidate,attention=null)=>featureJob({operation:'instance-match',template:template.toString('base64'),candidate:candidate.toString('base64'),...(attention?{templateAttention:attention}:{})});
export const compareReferenceShape=(template,candidate)=>featureJob({operation:'reference-shape',template:template.toString('base64'),candidate:candidate.toString('base64')});
export const comparePreparedOutlines=(template,candidate,attention={})=>featureJob({operation:'outline-match',template:template.toString('base64'),candidate:candidate.toString('base64'),...attention});
export async function fastFeatureCompare(reference,candidate){await prepareFastFeatures();const descriptor=await subjectDescriptor(reference);return descriptor.valid?comparePreparedFeatures(descriptor.cropped,candidate):{matched:false,reason:'参考主体不完整'};}
export async function instanceFeatureCompare(reference,candidate,referenceText=''){await prepareFastFeatures();const descriptor=await subjectDescriptor(reference);if(!descriptor.valid)return {matched:false,reason:'参考主体不完整'};const focused=await instanceReference(descriptor,referenceText);return comparePreparedInstances(descriptor.cropped,candidate,focused.attentionWeights);}
export function closeFastFeatures(){}
