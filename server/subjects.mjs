import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {descriptorCache} from './descriptor-cache.mjs';
import {ATTENTION_REVISION,identifyAttention,productRegionHint} from './product-attention.mjs';

export const SUBJECT_MODELS={segment:{id:'onnx-community/BiRefNet_lite-ONNX',revision:'de15b22ba131738a16dff04aab8bdf8dc32e3ac1'},features:{id:'Xenova/dinov2-small',revision:'c2bb04a51fab207c420665f1946016107bffc701'}};
export const subjectState={state:'idle',message:'主体比对模型尚未加载',progress:null};
let modelsPromise,featuresPromise;
const cache=new Map();
let extractionQueue=Promise.resolve();
const attentionDirectory=fileURLToPath(new URL('../.cache/subjects-product-attention-v1/',import.meta.url));
const attentionCache=new Map();

export function prepareSubjects(){
  if(modelsPromise)return modelsPromise;
  subjectState.state='loading';subjectState.message='正在加载主体分割与视觉特征模型';
  modelsPromise=(async()=>{
    const lib=await import('@huggingface/transformers');
    lib.env.cacheDir=fileURLToPath(new URL('../.cache/models/',import.meta.url));
    const progress_callback=event=>{if(event.status==='progress'){subjectState.message='下载主体模型 '+event.file;subjectState.progress=Number.isFinite(event.progress)?Math.round(event.progress):null;}};
    const segment=await lib.AutoModel.from_pretrained(SUBJECT_MODELS.segment.id,{revision:SUBJECT_MODELS.segment.revision,dtype:'fp32',device:'cpu',progress_callback});
    const segmentProcessor=await lib.AutoProcessor.from_pretrained(SUBJECT_MODELS.segment.id,{revision:SUBJECT_MODELS.segment.revision});
    const featureModels=await prepareFeatures();
    subjectState.state='ready';subjectState.message='主体分割与特征比对已就绪';subjectState.progress=100;
    return {segment,segmentProcessor,...featureModels};
  })().catch(error=>{modelsPromise=null;subjectState.state='error';subjectState.message='主体模型加载失败：'+error.message.slice(0,160);throw error;});
  return modelsPromise;
}
export function prepareFeatures(){
  if(featuresPromise)return featuresPromise;
  featuresPromise=(async()=>{
    const lib=await import('@huggingface/transformers');lib.env.cacheDir=fileURLToPath(new URL('../.cache/models/',import.meta.url));
    const features=await lib.AutoModel.from_pretrained(SUBJECT_MODELS.features.id,{revision:SUBJECT_MODELS.features.revision,dtype:'q8',device:'cpu'});
    const featureProcessor=await lib.AutoProcessor.from_pretrained(SUBJECT_MODELS.features.id,{revision:SUBJECT_MODELS.features.revision});
    return {features,featureProcessor,RawImage:lib.RawImage};
  })().catch(error=>{featuresPromise=null;throw error;});return featuresPromise;
}
export function cosine(a,b){let dot=0,aa=0,bb=0;if(!a?.length||a.length!==b?.length)return 0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb))):0;}

export function compareDescriptors(a,b){
  if(!a?.valid||!b?.valid)return {valid:false,subjectSimilarity:null,reason:'商品主体提取不完整'};
  const subjectSimilarity=cosine(a.embedding,b.embedding);
  const nearest=(from,to)=>from.map(token=>{let index=-1,score=-1;to.forEach((other,i)=>{const value=cosine(token,other);if(value>score){index=i;score=value;}});return {index,score};});
  const ab=nearest(a.patches,b.patches),ba=nearest(b.patches,a.patches);
  const mutual=ab.filter((match,i)=>match.score>=.86&&ba[match.index]?.index===i);
  const localSimilarity=mutual.length?mutual.reduce((sum,item)=>sum+item.score,0)/mutual.length:0;
  const localCoverage=mutual.length/Math.max(1,Math.min(a.patches.length,b.patches.length));
  const colorSimilarity=a.colors.reduce((sum,value,i)=>sum+Math.sqrt(value*(b.colors[i]||0)),0);
  // This is a conservative visual matcher, not a calibrated identity probability.
  const matched=subjectSimilarity>=.94&&localSimilarity>=.92&&localCoverage>=.38&&colorSimilarity>=.88;
  return {valid:true,subjectSimilarity,localSimilarity,localCoverage,colorSimilarity,matched,reason:matched?'主体整体特征、局部细节与颜色分布一致':'主体特征尚不足以自动确认外观同款'};
}

async function extract(buffer){
  const {segment,segmentProcessor,features,featureProcessor,RawImage}=await prepareSubjects();
  const image=await RawImage.fromBlob(new Blob([await sharp(buffer).rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).png().toBuffer()]));
  const inputs=await segmentProcessor(image);
  const outputs=await segment({input_image:inputs.pixel_values});
  const maskTensor=outputs.output_image[0].sigmoid().mul(255).to('uint8');
  const mask=await RawImage.fromTensor(maskTensor).resize(image.width,image.height);
  let left=image.width,top=image.height,right=-1,bottom=-1,count=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(mask.data[(y*image.width+x)*mask.channels]>=160){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const coverage=count/(image.width*image.height);
  if(coverage<.015||coverage>.985||right-left<15||bottom-top<15)return {valid:false,coverage};
  const rgba=image.clone();rgba.putAlpha(mask);
  const bounds={left,top,width:right-left+1,height:bottom-top+1};
  const cropped=await sharp(Buffer.from(rgba.data),{raw:{width:rgba.width,height:rgba.height,channels:rgba.channels}}).extract(bounds).resize(224,224,{fit:'contain',background:'#ffffff00'}).png().toBuffer();
  return {...await describeCrop(cropped),coverage,bounds,cropped};
}

async function describeCrop(cropped,attention=null){
  const {features,featureProcessor,RawImage}=await prepareFeatures();
  const neutral=await sharp(cropped).flatten({background:'#fff'}).png().toBuffer();
  const subject=await RawImage.fromBlob(new Blob([neutral]));
  const featureInputs=await featureProcessor(subject);
  const featureOutput=await features(featureInputs);
  const hidden=featureOutput.last_hidden_state;
  let embedding=Array.from(featureOutput.pooler_output?.data||hidden.data.slice(0,hidden.dims.at(-1)));
  const size=hidden.dims.at(-1),grid=Math.round(Math.sqrt(hidden.dims[1]-1)),patches=[],positions=[];
  const {data:rgba224}=await sharp(cropped).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const colors=Array(64).fill(0);let colorCount=0;
  for(let pixel=0;pixel<224*224;pixel++)if(rgba224[pixel*4+3]>=160){const offset=pixel*4;const index=(rgba224[offset]>>6)*16+(rgba224[offset+1]>>6)*4+(rgba224[offset+2]>>6);const weight=attention?attention.weights[pixel]/255:1;colors[index]+=weight;colorCount+=weight;}
  const tokenWeight=(x,y)=>{
    let foreground=0,weight=0;const x0=Math.floor(x*224/grid),x1=Math.floor((x+1)*224/grid),y0=Math.floor(y*224/grid),y1=Math.floor((y+1)*224/grid);
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const offset=py*224+px;if(rgba224[offset*4+3]>=160){foreground++;weight+=attention.weights[offset]/255;}}
    return {coverage:foreground/((x1-x0)*(y1-y0)),weight:weight/Math.max(1,foreground)};
  };
  if(attention){
    embedding=Array(size).fill(0);let total=0;
    for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const region=tokenWeight(x,y);if(region.coverage<.5)continue;const weight=region.coverage*region.weight;total+=weight;for(let i=0;i<size;i++)embedding[i]+=hidden.data[(1+y*grid+x)*size+i]*weight;}
    embedding=embedding.map(value=>value/Math.max(1,total));
  }
  for(let y=1;y<grid;y+=2)for(let x=1;x<grid;x+=2){
    const px=Math.min(223,Math.floor((x+.5)*224/grid)),py=Math.min(223,Math.floor((y+.5)*224/grid));
    if(attention){const region=tokenWeight(x,y);if(region.coverage<.5||region.weight<.8)continue;}else if(rgba224[(py*224+px)*4+3]<160)continue;
    patches.push(Array.from(hidden.data.slice((1+y*grid+x)*size,(2+y*grid+x)*size)));positions.push([(x+.5)/grid,(y+.5)/grid]);
  }
  const preview=await sharp(cropped).resize(128,128).png().toBuffer();
  return {valid:patches.length>=6,embedding,patches,colors:colors.map(value=>value/Math.max(1,colorCount)),preview:'data:image/png;base64,'+preview.toString('base64'),cropped,...(attention?{positions,focusMode:ATTENTION_REVISION,attention:attention.summary,attentionWeights:attention.weights.toString('base64')}: {})};
}
export async function describePreparedSubject(cropped){
  const metadata=await sharp(cropped).metadata();
  if(metadata.width!==224||metadata.height!==224||!metadata.hasAlpha)throw new Error('仅支持已经分割的224像素前景');
  return describeCrop(cropped);
}

export function compareFocusedDescriptors(a,b){
  if(!a?.valid||!b?.valid||a.focusMode!==ATTENTION_REVISION||b.focusMode!==ATTENTION_REVISION)return {valid:false,matched:false,subjectSimilarity:null,reason:'商品关注区域的可见细节不足，保留无法确认'};
  const nearest=(from,to)=>from.map(token=>{let index=-1,score=-1;to.forEach((other,i)=>{const value=cosine(token,other);if(value>score){index=i;score=value;}});return {index,score};});
  const ab=nearest(a.patches,b.patches),ba=nearest(b.patches,a.patches),mutual=[];
  ab.forEach((match,i)=>{if(match.score>=.86&&ba[match.index]?.index===i)mutual.push({...match,source:i});});
  const subjectSimilarity=cosine(a.embedding,b.embedding),localSimilarity=mutual.length?mutual.reduce((sum,item)=>sum+item.score,0)/mutual.length:0;
  const localCoverage=mutual.length/Math.max(1,a.patches.length,b.patches.length);
  const colorSimilarity=a.colors.reduce((sum,value,i)=>sum+Math.sqrt(value*(b.colors[i]||0)),0);
  const points=mutual.map(item=>({a:a.positions?.[item.source],b:b.positions?.[item.index]}));
  let geometricRatio=0,spread=false;
  if(points.length>=12&&points.every(item=>item.a?.length===2&&item.b?.length===2)){
    const mean=key=>[0,1].map(axis=>points.reduce((sum,item)=>sum+item[key][axis],0)/points.length),am=mean('a'),bm=mean('b');
    let denominator=0,u=0,v=0;
    for(const {a:pa,b:pb}of points){const x=pa[0]-am[0],y=pa[1]-am[1],tx=pb[0]-bm[0],ty=pb[1]-bm[1];denominator+=x*x+y*y;u+=x*tx+y*ty;v+=x*ty-y*tx;}
    if(denominator>1e-6){u/=denominator;v/=denominator;geometricRatio=points.filter(({a:pa,b:pb})=>Math.hypot(u*(pa[0]-am[0])-v*(pa[1]-am[1])+bm[0]-pb[0],v*(pa[0]-am[0])+u*(pa[1]-am[1])+bm[1]-pb[1])<=.1).length/points.length;}
    spread=['a','b'].every(key=>[0,1].every(axis=>Math.max(...points.map(item=>item[key][axis]))-Math.min(...points.map(item=>item[key][axis]))>=.35));
  }
  // Separate conservative gates: weighted patch pooling is not the original CLS
  // score. Shared hands, logos or a few similar tokens cannot confirm a product.
  const matched=subjectSimilarity>=.96&&localSimilarity>=.94&&localCoverage>=.45&&colorSimilarity>=.90&&mutual.length>=12&&geometricRatio>=.75&&spread;
  return {valid:true,matched,subjectSimilarity,localSimilarity,localCoverage,colorSimilarity,geometricRatio,localMatches:mutual.length,reason:matched?'商品关注区域的整体特征、多个区域细节、几何对应与颜色一致':'商品关注区域的结构与细节对应仍不足以确认同款'};
}

function attentionRecord(value){return value.focusMode===ATTENTION_REVISION&&value.attention?.revision===ATTENTION_REVISION&&['applied','preserved'].includes(value.attention.status)&&Number.isFinite(value.attention.reducedFraction)&&value.attention.reducedFraction>=0&&value.attention.reducedFraction<=.55&&typeof value.attentionWeights==='string'&&Buffer.from(value.attentionWeights,'base64').length===224*224&&Array.isArray(value.positions)&&value.positions.length===value.patches?.length&&value.positions.every(point=>Array.isArray(point)&&point.length===2&&point.every(n=>Number.isFinite(n)&&n>=0&&n<=1));}
async function attentionDescriptor(descriptor,text){
  const hint=productRegionHint(text),key=createHash('sha256').update(ATTENTION_REVISION+':'+hint).update(descriptor.cropped).digest('hex');
  if(attentionCache.has(key))return attentionCache.get(key);
  const result=await descriptorCache(key,async()=>describeCrop(descriptor.cropped,await identifyAttention(descriptor.cropped,hint)),{directory:attentionDirectory,validate:attentionRecord});
  if(attentionCache.size>=256)attentionCache.delete(attentionCache.keys().next().value);attentionCache.set(key,result);return result;
}
async function orientedAttention(descriptor,mirror,rotation){
  const key=createHash('sha256').update(ATTENTION_REVISION+':orientation:'+mirror+':'+rotation).update(descriptor.cropped).update(descriptor.attentionWeights).digest('hex');
  if(attentionCache.has(key))return attentionCache.get(key);
  const result=await descriptorCache(key,async()=>{
    let cropped=descriptor.cropped,weights=Buffer.from(descriptor.attentionWeights,'base64');
    weights=await sharp(weights,{raw:{width:224,height:224,channels:1}}).png().toBuffer();
    if(mirror){cropped=await sharp(cropped).flop().png().toBuffer();weights=await sharp(weights).flop().png().toBuffer();}
    if(rotation){cropped=await sharp(cropped).rotate(rotation,{background:'#ffffff00'}).png().toBuffer();weights=await sharp(weights).rotate(rotation).png().toBuffer();}
    weights=await sharp(weights).greyscale().raw().toBuffer();
    return describeCrop(cropped,{weights,summary:descriptor.attention});
  },{directory:attentionDirectory,validate:attentionRecord});
  if(attentionCache.size>=256)attentionCache.delete(attentionCache.keys().next().value);attentionCache.set(key,result);return result;
}

export async function subjectDescriptor(buffer){
  const key=createHash('sha256').update(buffer).digest('hex');
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  const task=extractionQueue.then(async()=>{
    if(cache.has(key))return cache.get(key);
    const result=await descriptorCache(key,()=>extract(buffer));if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  });
  extractionQueue=task.catch(()=>{});return task;
}
export async function compareSubjects(reference,candidate,options={}){
  const [baseA,baseB]=await Promise.all([subjectDescriptor(reference),subjectDescriptor(candidate)]);
  return comparePreparedSubjects(baseA,baseB,options);
}
export async function comparePreparedSubjects(baseA,baseB,options={}){
  let a=baseA,b=baseB,attention={status:'preserved',applied:false,reason:'主体提取不完整，未调整关注区域'},focused=false;
  if(a.valid&&b.valid)try{
    const attendedA=await attentionDescriptor(a,options.referenceText||''),attendedB=await attentionDescriptor(b,options.candidateText||'');
    focused=attendedA.attention.applied||attendedB.attention.applied;
    attention={status:focused?'applied':'preserved',applied:focused,reference:attendedA.attention,candidate:attendedB.attention,reason:focused?'人体识别与颜色共同支持的区域已降权；原图与前景保持原样':'未找到可可靠降权的人体区域，原区域保持参与核对'};
    if(focused){a=attendedA;b=attendedB;}
  }catch(error){attention={status:'unavailable',applied:false,reason:'区域关注未完成，已保留原主体复核：'+error.message.slice(0,120)};}
  const compare=focused?compareFocusedDescriptors:compareDescriptors;
  const verify=async result=>{
    if(focused&&result.matched)try{
      const {compareFocusedFeatures}=await import('./fast-features.mjs');
      const detailVerification=await compareFocusedFeatures(result.descriptor,b);
      result={...result,matched:detailVerification.matched,detailVerification,reason:detailVerification.matched?'商品关注区域的特征、几何对应、颜色和局部图像内容一致':'商品关注区域的局部图像内容仍未核实，保留无法确认'};
    }catch(error){result={...result,matched:false,detailVerification:{matched:false,reason:error.message.slice(0,160)},reason:'商品关注区域的细节校验未完成，保留无法确认'};}
    delete result.descriptor;return result;
  };
  let best=await verify({...compare(a,b),descriptor:a,referencePreview:baseA.preview,candidatePreview:baseB.preview,orientation:{mirror:false,rotation:0}});
  const attempts=[{mirror:false,rotation:0,matched:Boolean(best.matched)}];
  if(!best.matched&&a.valid&&b.valid)for(const [mirror,rotation] of [[true,0],[false,90],[false,180],[false,270],[true,90],[true,180],[true,270]]){
    const transformed=focused?await orientedAttention(a,mirror,rotation):await orientedSubject(a,mirror,rotation);
    const result=await verify({...compare(transformed,b),descriptor:transformed,referencePreview:transformed.preview,candidatePreview:baseB.preview,orientation:{mirror,rotation}});
    attempts.push({mirror,rotation,matched:Boolean(result.matched)});
    if(result.matched||(result.subjectSimilarity||0)>(best.subjectSimilarity||0))best=result;
    if(result.matched)break;
  }
  return {...best,attention,orientationAttempts:attempts,model:focused?'BiRefNet-lite + CLIPSeg/颜色关注 + DINOv2-small':'BiRefNet-lite + DINOv2-small'};
}
async function orientedSubject(descriptor,mirror,rotation){
  const key=createHash('sha256').update('subject-orientation-v1:'+mirror+':'+rotation).update(descriptor.cropped).digest('hex');
  if(cache.has(key))return cache.get(key);
  const task=extractionQueue.then(async()=>{
    if(cache.has(key))return cache.get(key);
    const result=await descriptorCache(key,async()=>{
      let cropped=descriptor.cropped;
      if(mirror)cropped=await sharp(cropped).flop().png().toBuffer();
      if(rotation)cropped=await sharp(cropped).rotate(rotation,{background:'#ffffff00'}).png().toBuffer();
      return describeCrop(cropped);
    });
    if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  });
  extractionQueue=task.catch(()=>{});return task;
}
export function cachedSubjectComparison(reference,candidate){
  const key=buffer=>createHash('sha256').update(buffer).digest('hex');
  const a=cache.get(key(reference)),b=cache.get(key(candidate));
  return a&&b?{...compareDescriptors(a,b),referencePreview:a.preview,candidatePreview:b.preview,model:'BiRefNet-lite + DINOv2-small'}:null;
}
