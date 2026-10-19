import sharp from 'sharp';
import { localSpecChecks, decideExact,decideProductMatch } from '../shared/core.mjs';
import {compareSubjects} from './subjects.mjs';
import {fastFeatureCompare,instanceFeatureCompare} from './fast-features.mjs';

export function imageBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 12_000_000) throw new Error('图片过大，请使用 8 MB 以下图片');
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('请上传 PNG、JPG 或 WebP 图片');
  const buffer = Buffer.from(match[2],'base64');
  if (!buffer.length || buffer.length > 8_000_000) throw new Error('图片为空或超过 8 MB');
  return buffer;
}

export async function compareFullPhotoEncoding(referenceBuffer,candidateBuffer){
  const [left,right]=await Promise.all([referenceBuffer,candidateBuffer].map(async buffer=>{
    const image=sharp(buffer,{limitInputPixels:40_000_000}).rotate();const metadata=await image.metadata();
    const aspect=metadata.orientation>=5&&metadata.orientation<=8?metadata.height/metadata.width:metadata.width/metadata.height;
    return {aspect,data:await image.flatten({background:'#fff'}).removeAlpha().resize(512,512,{fit:'contain',background:'#fff'}).toColourspace('srgb').raw().toBuffer()};
  }));
  if(!Number.isFinite(left.aspect)||Math.abs(left.aspect/right.aspect-1)>.01)return {matched:false,reason:'完整图片比例不同'};
  const a=left.data,b=right.data,quadrants=[0,0,0,0];let meanError=0,worstTileError=0,texturedTiles=0;
  for(let ty=0;ty<16;ty++)for(let tx=0;tx<16;tx++){
    let error=0,energyAX=0,energyAY=0,energyBX=0,energyBY=0,energySamples=0;
    for(let y=ty*32;y<(ty+1)*32;y++)for(let x=tx*32;x<(tx+1)*32;x++){
      const offset=(y*512+x)*3;
      for(let c=0;c<3;c++){
        const i=offset+c;error+=Math.abs(a[i]-b[i]);
        if(x>0&&x<511&&y>0&&y<511){energySamples++;
          energyAX+=Math.abs(2*a[i]-a[i-3]-a[i+3]);energyAY+=Math.abs(2*a[i]-a[i-1536]-a[i+1536]);
          energyBX+=Math.abs(2*b[i]-b[i-3]-b[i+3]);energyBY+=Math.abs(2*b[i]-b[i-1536]-b[i+1536]);
        }
      }
    }
    error/=3072;meanError+=error;worstTileError=Math.max(worstTileError,error);
    if(Math.min(energyAX,energyAY,energyBX,energyBY)/Math.max(1,energySamples)>=.45){texturedTiles++;quadrants[(ty>=8?2:0)+(tx>=8?1:0)]++;}
  }
  meanError/=256;
  const matched=meanError<=3&&worstTileError<=6&&texturedTiles>=48&&quadrants.every(count=>count>=6);
  return {matched,meanError,worstTileError,texturedTiles,quadrants,reason:matched?'全图分布的纹理及每个局部区域一致，差异符合压缩 / 缩放副本':'完整图片局部内容或分布尚未确认一致'};
}

export async function comparePixels(referenceBuffer,candidateBuffer,{sameAsset=false}={}) {
  const imageOptions={limitInputPixels:40_000_000};
  const [a,b]=await Promise.all([referenceBuffer,candidateBuffer].map(buffer=>sharp(buffer,imageOptions).rotate().removeAlpha().resize(256,256,{fit:'contain',background:'#fff'}).toColourspace('srgb').raw().toBuffer()));
  let difference=0,mean=0,variance=0;
  for(let i=0;i<a.length;i++){difference+=Math.abs(a[i]-b[i]);mean+=a[i];}
  mean/=a.length;
  for(const value of a) variance+=(value-mean)**2;
  variance/=a.length;
  const imageSimilarity=Math.max(0,1-difference/(a.length*255));
  const pixelIdentical=a.equals(b)&&variance>100;
  // A global similarity score alone never confirms a photo. Different URLs can
  // hold recompressed copies, so independently verify every image region.
  const assetVerified=sameAsset&&variance>100&&imageSimilarity>.95;
  const photoEncoding=!pixelIdentical&&!assetVerified&&variance>100&&imageSimilarity>=.985?await compareFullPhotoEncoding(referenceBuffer,candidateBuffer):null;
  const reencodedPhoto=photoEncoding?.matched===true;
  const identical=pixelIdentical||assetVerified||reencodedPhoto;
  return {visual:identical?'same_photo':'uncertain',imageSimilarity,samePhoto:identical,pixelIdentical,assetVerified,reencodedPhoto,photoEncoding};
}

// Page-image matching is independent of the subject model and its cache.
// It restores the original pixel / official-image-resource evidence for retrieval.
export async function pageCompare(referenceBuffer,candidateBuffer,referenceSpecs,candidateText,options={}) {
  const pixels=options.photoComparison||await comparePixels(referenceBuffer,candidateBuffer,options);
  const comparison={...pixels,subject:null,checks:localSpecChecks(referenceSpecs,candidateText),differences:[],evidence:[pixels.pixelIdentical?'标准化图片像素一致':pixels.assetVerified?'同一官方商品图片资源，尺寸 / 格式转换后图像内容一致':pixels.reencodedPhoto?'完整图片纹理与全图局部内容一致，确认压缩 / 缩放同图副本':'页面图片尚未确认一致，留待后续主体核对']};
  return {...comparison,...decideProductMatch(comparison,referenceSpecs,candidateText),engine:'page-image',matchStage:'page-image'};
}

export async function localCompare(referenceBuffer,candidateBuffer,referenceSpecs,candidateText,options={}) {
  options.signal?.throwIfAborted();
  const pixels=options.photoComparison||await comparePixels(referenceBuffer,candidateBuffer,options);
  let fastMatch=null,instanceMatch=null;
  if(options.subjectMatching&&!pixels.samePhoto){
    try{fastMatch=await fastFeatureCompare(referenceBuffer,candidateBuffer,options);}catch(error){fastMatch={matched:false,reason:'快速特征核验不可用，使用原主体模型',error:String(error.message||error).slice(0,160)};}
  }
  options.signal?.throwIfAborted();
  if(options.subjectMatching&&!pixels.samePhoto&&!fastMatch?.matched)try{instanceMatch=await instanceFeatureCompare(referenceBuffer,candidateBuffer,options.referenceText,options);}catch(error){instanceMatch={matched:false,reason:'商品实例核验未完成，继续原主体复核',error:String(error.message||error).slice(0,120)};}
  options.signal?.throwIfAborted();
  const subject=options.subjectMatching&&!pixels.samePhoto&&!fastMatch?.matched&&!instanceMatch?.matched?await compareSubjects(referenceBuffer,candidateBuffer,{referenceText:options.referenceText,candidateText,signal:options.signal}):null;
  const comparison={...pixels,fastMatch,instanceMatch,subject,checks:localSpecChecks(referenceSpecs,candidateText),differences:[],evidence:[pixels.pixelIdentical?'标准化图片像素一致':pixels.assetVerified?'同一官方商品图片资源，尺寸 / 格式转换后图像内容一致':pixels.reencodedPhoto?'完整图片纹理与全图局部内容一致，确认压缩 / 缩放同图副本':fastMatch?.matched?'SIFT 快速核验：至少 24 个几何一致点，匹配覆盖主体多个区域，整体颜色及局部图像内容一致':instanceMatch?.matched?instanceMatch.reason:subject?.reason||'本地引擎无法确认这两张图片一致']};
  if(instanceMatch?.matched)comparison.evidence.push('商品本体实例已核验，图中重复数量不参与排除；该链接套装组成和具体 SKU 仍按页面原文记录，未折算单件价格');
  if(fastMatch?.matched)comparison.evidence.push('几何一致点 '+fastMatch.inliers+'；主体匹配点覆盖 '+Math.round(fastMatch.subjectCoverage*100)+'%；局部图像误差 '+fastMatch.worstRegionError.toFixed(2)+'（指标不是同款概率）');
  if(subject?.attention){
    comparison.evidence.push(subject.attention.reason);
    if(subject.attention.applied)comparison.evidence.push('前景中按人体证据降低比对权重的区域：参考 '+Math.round(subject.attention.reference.reducedFraction*100)+'%，候选 '+Math.round(subject.attention.candidate.reducedFraction*100)+'%；保留原图和前景，仍需商品多个区域的结构与细节对应');
  }
  const orientation=fastMatch?.matched?fastMatch.orientation:subject?.matched?subject.orientation:null;
  if(orientation&&(orientation.mirror||orientation.rotation))comparison.evidence.push('方向复核通过：参考主体'+(orientation.mirror?'镜像翻转':'')+(orientation.mirror&&orientation.rotation?'并':'')+(orientation.rotation?'旋转 '+orientation.rotation+'°':'')+'后完成主体对齐；原商品图片与页面信息保持原样');
  const decide=options.subjectMatching?decideProductMatch:decideExact;
  return {...comparison,...decide(comparison,referenceSpecs,candidateText),engine:'local'};
}
