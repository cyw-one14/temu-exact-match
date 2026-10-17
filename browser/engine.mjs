import sharp from './sharp.mjs';
import {createHash} from './crypto.mjs';
import {ImageLoader} from './image-loader.mjs';
import {PhotoCache} from './photo-cache.mjs';
import {imageBuffer,comparePixels,pageCompare,localCompare} from '../server/vision.mjs';
import {prepareSubjects,subjectState,subjectDescriptor,compareDescriptors,compareForegroundColors} from '../server/subjects.mjs';
import {attentionState} from '../server/product-attention.mjs';
import {prepareFastFeatures,fastFeatureState,compareReferenceShape} from './fast-features.mjs';
import {compareForegroundOutlines} from '../server/outline-match.mjs';
import {groupedProductReview} from '../server/match-flow.mjs';
import {isProductMatch,listingSpecs} from '../shared/core.mjs';
import {titleMatchEvidence} from '../shared/title-match.mjs';
import {officialImage} from '../shared/provider.mjs';
import {sameProductImageAsset} from '../shared/image-assets.mjs';
import {segmentationDevice} from './transformers.mjs';

const images=new ImageLoader({allowed:officialImage,decodeData:imageBuffer,decode:input=>sharp(input).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).png().toBuffer()});
const loadImage=url=>images.get(url);
export const prefetch=urls=>images.prefetch(urls);
const photos=new PhotoCache(comparePixels),references=new Map();
function referenceBuffer(data){if(!references.has(data)){references.set(data,imageBuffer(data));if(references.size>2)references.delete(references.keys().next().value);}return references.get(data);}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
export function health(){const model={...subjectState};if(model.state==='ready'&&fastFeatureState.state!=='ready'){model.state=fastFeatureState.state==='unavailable'?'error':'loading';model.message=fastFeatureState.message;model.progress=null;}return {ok:true,engine:'browser',runtime:'browser-wasm-v1',segmentationDevice,configured:true,matchingPolicy:'title-groups-outline-v16',model,productAttention:{...attentionState},fastFeatures:{...fastFeatureState}};}
export async function prepare(){await Promise.all([prepareSubjects(),prepareFastFeatures()]);return health();}
export async function request(path,body={}){
  if(path==='/health')return health();
  if(path==='/prepare')return {ok:true,...await prepare()};
  if(path==='/image')return {ok:true,dataUrl:'data:image/png;base64,'+(await loadImage(body.imageUrl)).buffer.toString('base64')};
  if(path!=='/compare')throw Error('浏览器识别操作无效');
  const reference=referenceBuffer(body.referenceImage),candidate=await loadImage(body.imageUrl),specs=body.referenceSpecs||{};
  const options={sameAsset:sameProductImageAsset(body.referenceImageUrl,body.imageUrl),referenceText:String(body.referenceTitle||'').slice(0,1000)};
  const photoKey=digest(reference)+':'+digest(candidate.buffer)+':'+options.sameAsset;
  options.photoComparison=await photos.get(photoKey,reference,candidate.buffer,options);
  if(body.phase==='image-priority'){const result=options.photoComparison;return {ok:true,comparison:{...result,subject:null,matchStage:'page-image',priorityScore:result.samePhoto?1:result.imageSimilarity}};}
  const text=String(body.candidateText||'').slice(0,18000);
  if(body.phase!=='subject-review')return {ok:true,comparison:{...await pageCompare(reference,candidate.buffer,specs,text,options),engine:'browser',matchedImageUrl:body.imageUrl}};
  await prepare();options.subjectMatching=true;
  const titleEvidence=titleMatchEvidence(body.referenceTitle,String(body.candidateTitle||'').slice(0,2000),specs.brand,listingSpecs(text).specs.brand);
  const review=async()=>{
    let result=await pageCompare(reference,candidate.buffer,specs,text,options);
    if(!isProductMatch(result))result=await localCompare(reference,candidate.buffer,specs,text,options);
    result.matchStage='subject-review';result.matchedImageUrl=body.imageUrl;
    const errors=[];
    const gallery=['public-jsonld','bound-current-product-gallery'].includes(body.referenceImageSource)?[...new Set(Array.isArray(body.referenceImages)?body.referenceImages:[])].filter(url=>typeof url==='string'&&!sameProductImageAsset(url,body.referenceImageUrl)).slice(0,3):[];
    if(!isProductMatch(result)&&gallery.length){
      const anchor=await subjectDescriptor(reference);
      for(const imageUrl of gallery)try{
        const photo=await loadImage(imageUrl),descriptor=await subjectDescriptor(photo.buffer),compatibility=compareDescriptors(anchor,descriptor);
        if(!compatibility.valid||compatibility.subjectSimilarity<.75||compatibility.colorSimilarity<.88)continue;
        if(!(await compareReferenceShape(anchor.cropped,descriptor.cropped)).compatible)continue;
        const evaluated=await localCompare(photo.buffer,candidate.buffer,specs,text,{subjectMatching:true,referenceText:options.referenceText});
        if(isProductMatch(evaluated)){result={...evaluated,matchStage:'subject-review',matchedImageUrl:body.imageUrl,matchedReferenceImageUrl:imageUrl,referenceEvidence:body.referenceImageSource,evidence:[...evaluated.evidence,'使用当前已打开商品页所属且与主图相容的图片补充参考；未打开商品页面']};break;}
      }catch(error){errors.push('参考图片：'+error.message);}
    }
    if(!isProductMatch(result))for(const imageUrl of [...new Set(Array.isArray(body.candidateImages)?body.candidateImages:[])].filter(url=>typeof url==='string'&&url!==body.imageUrl).slice(0,2))try{
      const alternative=await loadImage(imageUrl),evaluated=await localCompare(reference,alternative.buffer,specs,text,{sameAsset:sameProductImageAsset(body.referenceImageUrl,imageUrl),subjectMatching:true});
      if(isProductMatch(evaluated)||(evaluated.subject?.subjectSimilarity||0)>(result.subject?.subjectSimilarity||0))result={...evaluated,matchStage:'subject-review',matchedImageUrl:imageUrl};
      if(isProductMatch(result))break;
    }catch(error){errors.push(error.message);}
    if(errors.length)result.alternativeErrors=errors;return result;
  };
  const selected=reviewed=>reviewed.matchedImageUrl===body.imageUrl?Promise.resolve(candidate):loadImage(reviewed.matchedImageUrl);
  const comparison=await groupedProductReview({titleEvidence,review,referenceSpecs:specs,candidateText:text,colors:async reviewed=>compareForegroundColors(reference,(await selected(reviewed)).buffer,{referenceText:options.referenceText,candidateText:text}),outlines:async reviewed=>compareForegroundOutlines(reference,(await selected(reviewed)).buffer,{referenceText:options.referenceText,candidateText:text})});
  return {ok:true,comparison:{...comparison,engine:'browser'}};
}
