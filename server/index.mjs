import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {normalizeImage,MAX_IMAGE_BYTES,sameProductImageAsset} from './images.mjs';
import {imageBuffer,localCompare,comparePixels,pageCompare} from './vision.mjs';
import {subjectState,prepareSubjects,subjectDescriptor,compareDescriptors,compareForegroundColors,prepareReferenceFeatures} from './subjects.mjs';
import {fastFeatureState,prepareFastFeatures,closeFastFeatures,compareReferenceShape} from './fast-features.mjs';
import {isProductMatch,listingSpecs} from '../shared/core.mjs';
import {titleMatchEvidence} from '../shared/title-match.mjs';
import {groupedProductReview} from './match-flow.mjs';
import {compareForegroundOutlines} from './outline-match.mjs';
import {attentionState,prepareAttention} from './product-attention.mjs';
import {recordSubjectResult} from './match-diagnostics.mjs';
import {NATIVE_REVISION,nativeDevice,nativeThreads,nativeWorkers} from './native-runtime.mjs';
import {WorkQueue} from './parallel-work.mjs';
import {PhotoCache} from './photo-cache.mjs';
import {nativeModelHealth,closeNativeModels} from './native-model-client.mjs';

export const PORT=Number(process.env.TEMU_MATCH_PORT || 43187);
const ROOT=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('extension/manifest.json',ROOT),'utf8'));
if(!manifest.key) throw new Error('请先运行 node scripts/init-key.mjs');
export const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
const installationId=createHash('sha256').update(fileURLToPath(ROOT).toLowerCase()).digest('hex').slice(0,20);
const extensionOrigin='chrome-extension://'+extensionId;
const localOrigin='http://127.0.0.1:'+PORT;
const imageCache=new Map();
const photos=new PhotoCache(comparePixels),references=new Map();
const reviews=new WorkQueue(nativeWorkers);
function referenceBuffer(data){if(!references.has(data)){references.set(data,imageBuffer(data));if(references.size>2)references.delete(references.keys().next().value);}return references.get(data);}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
let preparing;
export function prepareNative(){return preparing??=(async()=>{try{await Promise.all([prepareSubjects(),prepareFastFeatures(),prepareAttention()]);}catch(error){preparing=null;throw error;}})();}
let activeDownloads=0;const waitingDownloads=[];
async function downloadSlot(task){if(activeDownloads>=3)await new Promise(resolve=>waitingDownloads.push(resolve));else activeDownloads++;try{return await task();}finally{const next=waitingDownloads.shift();if(next)next();else activeDownloads--;}}

async function getJSON(req){
  if(!String(req.headers['content-type']||'').startsWith('application/json')) throw Object.assign(new Error('需要 application/json 请求'),{status:415});
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>13_000_000)throw Object.assign(new Error('请求超过图片大小限制'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('请求 JSON 无效'),{status:400});}
}

export function allowedImageUrl(raw){
  const url=new URL(raw);
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !(url.hostname==='kwcdn.com'||url.hostname.endsWith('.kwcdn.com')||url.hostname==='temu.com'||url.hostname.endsWith('.temu.com'))) throw new Error('只允许读取 TEMU 官方商品图片地址');
  return url;
}

async function downloadImage(raw){
  if(imageCache.has(raw)){const task=imageCache.get(raw);imageCache.delete(raw);imageCache.set(raw,task);return task;}
  const task=downloadSlot(()=>readImage(raw));imageCache.set(raw,task);
  if(imageCache.size>64)imageCache.delete(imageCache.keys().next().value);
  task.catch(()=>{if(imageCache.get(raw)===task)imageCache.delete(raw);});return task;
}
async function readImage(raw){
  let url=allowedImageUrl(raw);let response;
  for(let i=0;i<4;i++){
    response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25_000)});
    if(response.status>=300 && response.status<400){url=allowedImageUrl(new URL(response.headers.get('location'),url).href);continue;}
    break;
  }
  if(!response?.ok)throw new Error('商品图片无法读取（HTTP '+response?.status+'）');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>MAX_IMAGE_BYTES)throw new Error('商品图片超过 8 MB');chunks.push(chunk);}
  const value=await normalizeImage(Buffer.concat(chunks));
  return value;
}

const staticFiles={
  '/setup':['server/setup.html','text/html; charset=utf-8'],
  '/setup.js':['server/setup.js','text/javascript; charset=utf-8'],
  '/setup.css':['server/setup.css','text/css; charset=utf-8']
};

export const server=http.createServer(async(req,res)=>{
  const cancellation=new AbortController(),signal=cancellation.signal;
  res.on('close',()=>{if(!res.writableEnded)cancellation.abort();});
  try{
    if(req.headers.host!=='127.0.0.1:'+PORT && req.headers.host!=='localhost:'+PORT)throw Object.assign(new Error('Host 不匹配'),{status:403});
    const origin=req.headers.origin;
    const accepted=origin===extensionOrigin || origin===localOrigin;
    const sameOriginRead=!origin && req.method==='GET' && req.headers['sec-fetch-site']==='same-origin';
    if(origin && !accepted)throw Object.assign(new Error('请求来源未授权'),{status:403});
    if(accepted){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS'){
      if(!accepted)throw Object.assign(new Error('请求来源未授权'),{status:403});
      res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Temu-Client');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;
    }
    const path=new URL(req.url,localOrigin).pathname;
    if(req.method==='GET' && staticFiles[path]){
      const [file,type]=staticFiles[path];res.setHeader('Content-Type',type);res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.end(await readFile(new URL(file,ROOT)));return;
    }
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method==='GET' && path==='/health'){
      const model={...subjectState};if(model.state==='ready'&&(fastFeatureState.state!=='ready'||attentionState.state!=='ready')){model.state=fastFeatureState.state==='unavailable'||attentionState.state==='unavailable'?'error':'loading';model.message='正在准备本机细节与人体关注核验';}
      const worker=nativeModelHealth();if(worker.state==='error'){model.state='error';model.message=worker.message;}
      res.end(JSON.stringify({ok:true,version:manifest.version,runtime:'native-local-v1',engineRevision:NATIVE_REVISION,installationId,acceleration:{device:nativeDevice,workers:nativeWorkers,threads:nativeThreads,auxiliaryThreads:nativeWorkers>1?1:nativeThreads,scheduling:'pipeline',segmentation:'BiRefNet-lite512 fp32'},matchingPolicy:'title-groups-outline-v16',engine:'local',configured:true,model,productAttention:attentionState,fastFeatures:fastFeatureState,extensionId}));return;
    }
    if((!accepted&&!sameOriginRead) || req.headers['x-temu-client']!=='exact-match')throw Object.assign(new Error('请从插件或本机设置页面访问'),{status:403});
    if(req.method==='GET' && path==='/config'){
      res.end(JSON.stringify({engine:'local',extensionPath:fileURLToPath(new URL('extension/',ROOT)),version:manifest.version}));return;
    }
    if(req.method!=='POST')throw Object.assign(new Error('接口不存在'),{status:404});
    const body=await getJSON(req);
    if(path==='/prepare'){
      await prepareNative();res.end(JSON.stringify({ok:true,model:subjectState}));return;
    }
    const specs=body.referenceSpecs||{};
    if(path==='/prefetch'){
      for(const url of [...new Set(Array.isArray(body.images)?body.images:[])].filter(url=>typeof url==='string').slice(0,3))downloadImage(url).catch(()=>{});
      if(body.referenceImage){
        const reference=String(body.referenceImage).startsWith('data:')?referenceBuffer(body.referenceImage):(await downloadImage(body.referenceImage)).buffer;
        signal.throwIfAborted();
        await reviews.run(()=>prepareReferenceFeatures(reference,String(body.referenceTitle||'').slice(0,1000),{signal}),{signal});
      }
      res.end(JSON.stringify({ok:true}));return;
    }
    if(path==='/image'){
      const image=await downloadImage(body.imageUrl);res.end(JSON.stringify({ok:true,dataUrl:image.dataUrl,sourceFormat:image.sourceFormat}));return;
    }
    if(path==='/compare'){
      const reference=referenceBuffer(body.referenceImage);
      const candidate=await downloadImage(body.imageUrl);
      const imageOptions={sameAsset:sameProductImageAsset(body.referenceImageUrl,body.imageUrl),referenceText:String(body.referenceTitle||'').slice(0,1000),signal};
      imageOptions.photoComparison=await photos.get(digest(reference)+':'+digest(candidate.buffer)+':'+imageOptions.sameAsset,reference,candidate.buffer,imageOptions);
      if(body.phase==='image-priority'){
        const priority=imageOptions.photoComparison;
        res.end(JSON.stringify({ok:true,comparison:{...priority,subject:null,matchStage:'page-image',priorityScore:priority.samePhoto?1:priority.imageSimilarity}}));return;
      }
      const text=String(body.candidateText||'').slice(0,18000);
      // A missing phase defaults to page matching. Models run only when the
      // panel explicitly starts the later subject-review stage.
      if(body.phase!=='subject-review'){
        const result=await pageCompare(reference,candidate.buffer,specs,text,imageOptions);
        if(PORT===43187)await recordSubjectResult(body,reference,candidate.buffer,result);
        res.end(JSON.stringify({ok:true,comparison:{...result,matchedImageUrl:body.imageUrl}}));return;
      }
      imageOptions.subjectMatching=true;
      const titleEvidence=titleMatchEvidence(body.referenceTitle,String(body.candidateTitle||'').slice(0,2000),specs.brand,listingSpecs(text).specs.brand);
      const review=async()=>{
        signal.throwIfAborted();
        let result=await pageCompare(reference,candidate.buffer,specs,text,imageOptions);
        if(!isProductMatch(result)){
          signal.throwIfAborted();result=await localCompare(reference,candidate.buffer,specs,text,imageOptions);
        }
        result.matchStage='subject-review';
        result.matchedImageUrl=body.imageUrl;
        const alternativeErrors=[];
        const gallery=['public-jsonld','bound-current-product-gallery'].includes(body.referenceImageSource)?[...new Set(Array.isArray(body.referenceImages)?body.referenceImages:[])].filter(url=>typeof url==='string'&&!sameProductImageAsset(url,body.referenceImageUrl)).slice(0,3):[];
        if(!isProductMatch(result)&&gallery.length){
          const anchor=await subjectDescriptor(reference,{signal});
          for(const imageUrl of gallery)try{
            signal.throwIfAborted();
            const photo=await downloadImage(imageUrl),descriptor=await subjectDescriptor(photo.buffer,{signal});
            const compatibility=compareDescriptors(anchor,descriptor);
            // Same-product provenance alone cannot introduce a different color,
            // accessory, category or unrelated image as a reference template.
            if(!compatibility.valid||compatibility.subjectSimilarity<.75||compatibility.colorSimilarity<.88)continue;
            const shape=await compareReferenceShape(anchor.cropped,descriptor.cropped,{signal});if(!shape.compatible)continue;
            signal.throwIfAborted();const evaluated=await localCompare(photo.buffer,candidate.buffer,specs,text,{subjectMatching:true,referenceText:imageOptions.referenceText,signal});
            if(isProductMatch(evaluated)){result={...evaluated,matchStage:'subject-review',matchedImageUrl:body.imageUrl,matchedReferenceImageUrl:imageUrl,referenceEvidence:body.referenceImageSource,evidence:[...evaluated.evidence,'使用原商品当前页所属且与主图外观/颜色相容的图片补充参考；未打开商品页面，具体 SKU 未绑定']};break;}
          }catch(error){signal.throwIfAborted();alternativeErrors.push('参考图片：'+error.message);}
        }
        if(!isProductMatch(result))for(const imageUrl of [...new Set(Array.isArray(body.candidateImages)?body.candidateImages:[])].filter(value=>typeof value==='string'&&value!==body.imageUrl).slice(0,2)){
          try{
            signal.throwIfAborted();
            const alternative=await downloadImage(imageUrl);
            const options={sameAsset:sameProductImageAsset(body.referenceImageUrl,imageUrl),subjectMatching:true,signal};
            signal.throwIfAborted();const evaluated=await localCompare(reference,alternative.buffer,specs,text,options);
            if(isProductMatch(evaluated)||(evaluated.subject?.subjectSimilarity||0)>(result.subject?.subjectSimilarity||0))result={...evaluated,matchStage:'subject-review',matchedImageUrl:imageUrl};
            if(isProductMatch(result))break;
          }catch(error){signal.throwIfAborted();alternativeErrors.push(error.message);}
        }
        if(alternativeErrors.length)result.alternativeErrors=alternativeErrors;
        return result;
      };
      const result=await reviews.run(()=>groupedProductReview({titleEvidence,review,referenceSpecs:specs,candidateText:text,colors:async reviewed=>{
        const selected=reviewed.matchedImageUrl===body.imageUrl?candidate:await downloadImage(reviewed.matchedImageUrl);
        signal.throwIfAborted();return compareForegroundColors(reference,selected.buffer,{referenceText:imageOptions.referenceText,candidateText:text,signal});
      },outlines:async reviewed=>{
        const selected=reviewed.matchedImageUrl===body.imageUrl?candidate:await downloadImage(reviewed.matchedImageUrl);
        signal.throwIfAborted();return compareForegroundOutlines(reference,selected.buffer,{referenceText:imageOptions.referenceText,candidateText:text,signal});
      }}),{signal});
      if(nativeModelHealth().state==='error')throw Error('本机计算线程中断，后台正在自动恢复');
      signal.throwIfAborted();if(PORT===43187)await recordSubjectResult(body,reference,candidate.buffer,result);
      res.end(JSON.stringify({ok:true,comparison:result}));return;
    }
    throw Object.assign(new Error('接口不存在'),{status:404});
  }catch(error){
    if(res.destroyed)return;
    const serviceUnavailable=nativeModelHealth().state==='error';
    if(!res.headersSent){res.setHeader('Content-Type','application/json; charset=utf-8');res.writeHead(serviceUnavailable?503:error.status||400);}
    res.end(JSON.stringify({ok:false,error:String(error.message||'服务错误').slice(0,300),...(serviceUnavailable?{serviceUnavailable:true}:{})}));
  }
});

if(process.argv[1]===fileURLToPath(import.meta.url)){
  server.on('close',closeFastFeatures);
  server.on('close',closeNativeModels);
  if(process.env.TEMU_WATCHDOG==='1'){
    // A supervisor that is ended on its own must not leave an unsupervised
    // server occupying the port and blocking the colleague's desktop launcher.
    const parentEnded=()=>{closeFastFeatures();closeNativeModels();server.closeAllConnections();server.close();process.exit(0);};
    process.stdin.once('end',parentEnded);process.stdin.once('error',parentEnded);process.stdin.resume();
  }
  await mkdir(new URL('.cache/',ROOT),{recursive:true});
  server.listen(PORT,'127.0.0.1',()=>{
    console.log('TEMU 本机服务已启动：http://127.0.0.1:'+PORT+'/setup');
    prepareNative().catch(error=>console.error('本机识别准备失败：'+error.message));
  });
}
