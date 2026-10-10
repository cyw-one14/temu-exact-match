import sharp from 'sharp';
import {fileURLToPath} from 'node:url';

export const ATTENTION_REVISION='semantic-color-v1';
export const ATTENTION_MODEL={id:'Xenova/clipseg-rd64-refined',revision:'924dc94f85f58739f353f94258b33bc47eae4862'};
export const attentionState={state:'idle',message:'人体与商品颜色关注模型尚未加载'};
let loading;
export function prepareAttention(){
  if(loading)return loading;
  attentionState.state='loading';attentionState.message='正在加载人体与商品区域关注模型';
  loading=(async()=>{
    const lib=await import('@huggingface/transformers');
    lib.env.cacheDir=fileURLToPath(new URL('../.cache/models/',import.meta.url));
    const options={revision:ATTENTION_MODEL.revision};
    const tokenizer=await lib.AutoTokenizer.from_pretrained(ATTENTION_MODEL.id,options);
    const processor=await lib.AutoProcessor.from_pretrained(ATTENTION_MODEL.id,options);
    const model=await lib.CLIPSegForImageSegmentation.from_pretrained(ATTENTION_MODEL.id,{...options,dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:4}});
    attentionState.state='ready';attentionState.message='人体识别与商品颜色关注已就绪';
    return {tokenizer,processor,model,RawImage:lib.RawImage};
  })().catch(error=>{loading=null;attentionState.state='unavailable';attentionState.message='区域关注不可用，保留原主体复核';throw error;});
  return loading;
}

// Internal region hints only; titles are NEVER identity evidence or a veto.
export function productRegionHint(text=''){
  if(/\bgloves?\b|手套/i.test(text))return 'rubber cleaning gloves';
  if(/\bcomb\b|梳/i.test(text))return 'a brown wooden wide tooth gua sha massage comb';
  if(/\b(?:toothpaste|squeezer)\b|牙膏/i.test(text))return 'toothpaste tube squeezer';
  return 'the main product';
}
function skinRange(r,g,b){
  const y=.299*r+.587*g+.114*b,cr=(r-y)*.713+128,cb=(b-y)*.564+128;
  return cr>=133&&cr<=180&&cb>=77&&cb<=135;
}
function lab(r,g,b){
  const linear=value=>{value/=255;return value>.04045?((value+.055)/1.055)**2.4:value/12.92;};
  r=linear(r);g=linear(g);b=linear(b);
  const f=value=>value>.008856?Math.cbrt(value):7.787*value+16/116;
  const x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.072175*b),z=f((.0193339*r+.119192*g+.9503041*b)/1.08883);
  // OpenCV-style byte Lab scale, matching the validated color experiment.
  return [(116*y-16)*255/100,500*(x-y)+128,200*(y-z)+128];
}
const squared=(a,b)=>a.reduce((sum,value,i)=>sum+(value-b[i])**2,0);
function prototypes(values){
  if(values.length<40)return null;
  // Bounded deterministic sample prevents color fitting from dominating CPU.
  const stride=Math.max(1,Math.ceil(values.length/2048)),samples=values.filter((_,i)=>i%stride===0);
  const centers=[samples[0]];
  while(centers.length<3){let best=samples[0],score=-1;for(const point of samples){const distance=Math.min(...centers.map(center=>squared(point,center)));if(distance>score){best=point;score=distance;}}centers.push(best);}
  for(let step=0;step<12;step++){
    const sums=centers.map(()=>[0,0,0]),counts=centers.map(()=>0);
    for(const point of samples){let index=0,distance=Infinity;centers.forEach((center,i)=>{const d=squared(point,center);if(d<distance){distance=d;index=i;}});counts[index]++;point.forEach((value,i)=>sums[index][i]+=value);}
    for(let i=0;i<centers.length;i++)if(counts[i])centers[i]=sums[i].map(value=>value/counts[i]);
  }
  return centers;
}
const nearest=(point,centers)=>Math.sqrt(Math.min(...centers.map(center=>squared(point,center))));

// Produces comparison WEIGHTS only. Never writes/mutates RGB, alpha, or inputs.
export function colorAttention(rgba,human,product,width=224,height=224){
  const pixels=width*height;
  if(rgba.length!==pixels*4||human.length!==pixels||product.length!==pixels)throw new Error('区域关注数据尺寸不一致');
  const weights=Buffer.alloc(pixels,255),values=new Map(),skin=[],goods=[];
  let foreground=0;
  for(let i=0;i<pixels;i++){
    const offset=i*4;if(rgba[offset+3]<160)continue;foreground++;
    const point=lab(rgba[offset],rgba[offset+1],rgba[offset+2]);values.set(i,point);
    const color=skinRange(rgba[offset],rgba[offset+1],rgba[offset+2]);
    if(color&&human[i]>=180&&human[i]>product[i]+50)skin.push(point);
    if(human[i]<100||product[i]>human[i]+25)goods.push(point);
  }
  const skinCenters=prototypes(skin),productCenters=prototypes(goods);
  let reduced=0;
  if(skinCenters&&productCenters)for(const [i,point]of values){
    const offset=i*4;
    if(human[i]<160||human[i]<=product[i]+25||!skinRange(rgba[offset],rgba[offset+1],rgba[offset+2]))continue;
    const a=nearest(point,skinCenters),b=nearest(point,productCenters);
    if(a<24&&a+12<b){weights[i]=26;reduced++;}
  }
  // Predominantly human-looking products or too little reliable product evidence
  // are ambiguous. Do not silently discard most of a mannequin/glove/skin item.
  const applied=reduced>=40&&reduced/Math.max(1,foreground)<=.55&&goods.length>=Math.max(40,foreground*.08);
  if(!applied)weights.fill(255);
  const summary={revision:ATTENTION_REVISION,status:applied?'applied':'preserved',applied,
    reducedFraction:applied?reduced/foreground:0,skinSeedPixels:skin.length,productSeedPixels:goods.length,
    reason:applied?'人体区域识别与每图颜色分布均有依据，仅降低明确人体区域的比对权重':'人体与商品颜色证据不足或有歧义，保留原区域参与核对'};
  return {weights,summary};
}

export async function identifyAttention(cropped,hint){
  const {data,info}=await sharp(cropped).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let possible=0;
  for(let i=0;i<info.width*info.height;i++)if(data[i*4+3]>=160&&skinRange(data[i*4],data[i*4+1],data[i*4+2]))possible++;
  if(possible<40)return {weights:Buffer.alloc(info.width*info.height,255),summary:{revision:ATTENTION_REVISION,status:'preserved',applied:false,reducedFraction:0,reason:'没有足够颜色线索，保留原区域参与核对'}};
  const {tokenizer,processor,model,RawImage}=await prepareAttention();
  const neutral=await sharp(cropped).flatten({background:'#fff'}).png().toBuffer();
  const prompts=[hint,'a human hand','a human arm','a human face','a glove'];
  const inputs={...tokenizer(prompts,{padding:true,truncation:true}),...await processor(await RawImage.fromBlob(new Blob([neutral])))};
  const output=await model(inputs),probs=output.logits.sigmoid().mul(255).to('uint8'),maps=[];
  for(let i=0;i<prompts.length;i++){const map=await RawImage.fromTensor(probs[i].unsqueeze(0)).resize(info.width,info.height);maps.push(map.data);}
  const human=new Uint8Array(info.width*info.height),product=new Uint8Array(human.length);
  for(let i=0;i<human.length;i++){human[i]=Math.max(maps[1][i],maps[2][i],maps[3][i]);product[i]=Math.max(maps[0][i],maps[4][i]);}
  return colorAttention(data,human,product,info.width,info.height);
}
