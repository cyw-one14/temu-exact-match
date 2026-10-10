import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sameProductImageAsset} from './images.mjs';
const directory=new URL('../.cache/',import.meta.url),file=new URL('recent-subject-results.json',directory);
let queue=Promise.resolve();
// Local diagnosis only, excluded from Git. No uploaded image bytes, credentials,
// page/account text, or persistent access data are written here.
export async function recordSubjectResult(body,reference,candidate,result){
  const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
  const safeUrl=raw=>{try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='kwcdn.com'||u.hostname.endsWith('.kwcdn.com')||u.hostname==='temu.com'||u.hostname.endsWith('.temu.com')))return '';u.hash='';if(!sameProductImageAsset(u.href,u.href))u.search='';return u.href;}catch{return '';}};
  const item={time:new Date().toISOString(),referenceImageUrl:safeUrl(body.referenceImageUrl),candidateImageUrl:safeUrl(body.imageUrl),referenceCacheKey:digest(reference),candidateCacheKey:digest(candidate),referenceImages:(Array.isArray(body.referenceImages)?body.referenceImages:[]).slice(0,6).map(safeUrl).filter(Boolean),referenceImageSource:['public-jsonld','bound-current-product-gallery'].includes(body.referenceImageSource)?body.referenceImageSource:'',status:result.status,matchedReferenceImageUrl:safeUrl(result.matchedReferenceImageUrl),instanceMatch:result.instanceMatch||null,subject:result.subject?{matched:result.subject.matched,subjectSimilarity:result.subject.subjectSimilarity,localSimilarity:result.subject.localSimilarity,localCoverage:result.subject.localCoverage,reason:result.subject.reason}:null,alternativeErrors:result.alternativeErrors||[]};
  const job=queue.then(async()=>{let entries=[];try{const text=await readFile(file,'utf8');if(text.length<2000000){const saved=JSON.parse(text);if(Array.isArray(saved))entries=saved;}}catch{}
    await mkdir(directory,{recursive:true});entries.push(item);await writeFile(file,JSON.stringify(entries.slice(-100),null,2));
  }).catch(()=>{});queue=job;await job;
}
