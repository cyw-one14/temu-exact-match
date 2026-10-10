// Offline comparison experiment only. Never changes alpha/pixels or production verdicts.
// Reuses the saved semantic hand probability maps from the abandoned removal trial.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {prepareSubjects,cosine} from '../server/subjects.mjs';

const root=new URL('../.cache/subject-validation/',import.meta.url);
const colorAttention=process.argv.includes('--color-attention');
const {features,featureProcessor,RawImage}=await prepareSubjects();
const directions=[[false,0],[true,0],[false,90],[false,180],[false,270],[true,90],[true,180],[true,270]];
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const inputs=new Map();
for(const name of ['comb-reference-cached','comb-candidate-cached','glove-subject','toothpaste-subject']){
  const image=await readFile(new URL(name+'.png',root));
  const hand=await readFile(new URL(name+'-hand-prob.png',root));
  const product=await readFile(new URL(name+'-product-prob.png',root));
  const weights=colorAttention?await readFile(new URL(name+'-color-attention.png',root)):null;
  inputs.set(name,{image,hand,product,weights,before:hash(image)});
}
async function transform(buffer,mirror,rotation){
  if(mirror)buffer=await sharp(buffer).flop().png().toBuffer();
  if(rotation)buffer=await sharp(buffer).rotate(rotation,{background:'#ffffff00'}).png().toBuffer();
  return buffer;
}
async function describe(name,mirror=false,rotation=0){
  const input=inputs.get(name);
  const image=await transform(input.image,mirror,rotation),hand=await transform(input.hand,mirror,rotation),product=await transform(input.product,mirror,rotation);
  // Exactly the existing neutral-background feature input; NO hand removal.
  const neutral=await sharp(image).flatten({background:'#fff'}).png().toBuffer();
  const outputs=await features(await featureProcessor(await RawImage.fromBlob(new Blob([neutral]))));
  const hidden=outputs.last_hidden_state,size=hidden.dims.at(-1),grid=Math.round(Math.sqrt(hidden.dims[1]-1));
  const rgba=await sharp(image).ensureAlpha().raw().toBuffer();
  const hands=await sharp(hand).removeAlpha().greyscale().raw().toBuffer();
  const products=await sharp(product).removeAlpha().greyscale().raw().toBuffer();
  const weights=colorAttention?await sharp(await transform(input.weights,mirror,rotation)).greyscale().raw().toBuffer():null;
  const tokens=[],plain=Array(size).fill(0),focused=Array(size).fill(0);
  let foregroundWeight=0,attentionWeight=0;
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
    let foreground=0,attention=0;
    const x0=Math.floor(x*224/grid),x1=Math.floor((x+1)*224/grid),y0=Math.floor(y*224/grid),y1=Math.floor((y+1)*224/grid);
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){
      const offset=py*224+px;if(rgba[offset*4+3]<160)continue;
      // Preserve ambiguous regions and regions also recognized as the product
      // (e.g. gloves). Lower only strongly hand-dominated evidence.
      foreground++;attention+=weights?weights[offset]/255:(hands[offset]>=160&&hands[offset]>products[offset]+25?.1:1);
    }
    const area=(x1-x0)*(y1-y0);foreground/=area;attention/=area;
    if(foreground<.5)continue;
    const token=Array.from(hidden.data.slice((1+y*grid+x)*size,(2+y*grid+x)*size));
    tokens.push({token,weight:attention,x,y});foregroundWeight+=foreground;attentionWeight+=attention;
    for(let i=0;i<size;i++){plain[i]+=token[i]*foreground;focused[i]+=token[i]*attention;}
  }
  return {plain,focused,tokens,attentionFraction:attentionWeight/foregroundWeight};
}
function compare(a,b){
  const nearest=(from,to)=>from.map(item=>{let index=-1,score=-1;to.forEach((other,i)=>{const value=cosine(item.token,other.token);if(value>score){index=i;score=value;}});return {index,score};});
  const at=a.tokens.filter(item=>item.weight>=.5),bt=b.tokens.filter(item=>item.weight>=.5);
  const ab=nearest(at,bt),ba=nearest(bt,at);
  const mutual=ab.filter((item,i)=>item.score>=.86&&ba[item.index]?.index===i);
  return {unweightedPool:cosine(a.plain,b.plain),attentionPool:cosine(a.focused,b.focused),localSimilarity:mutual.length?mutual.reduce((sum,item)=>sum+item.score,0)/mutual.length:0,localCoverage:mutual.length/Math.max(1,Math.min(at.length,bt.length)),referenceTokens:at.length,candidateTokens:bt.length,referenceAttentionFraction:a.attentionFraction,candidateAttentionFraction:b.attentionFraction};
}
const candidate=await describe('comb-candidate-cached'),attempts=[];
for(const [mirror,rotation]of directions){
  const reference=await describe('comb-reference-cached',mirror,rotation);
  const result={mirror,rotation,...compare(reference,candidate)};
  attempts.push(result);console.log(JSON.stringify({sample:'actual-comb-pair',...result}));
}
const reference=await describe('comb-reference-cached');
const negatives=[];
for(const name of ['glove-subject','toothpaste-subject']){
  const result={sample:name,...compare(reference,await describe(name))};negatives.push(result);console.log(JSON.stringify(result));
}
let originalsUnchanged=true;
for(const [name,input]of inputs)originalsUnchanged&&=hash(await readFile(new URL(name+'.png',root)))===input.before;
const report={experimental:true,productionEnabled:false,method:colorAttention?'Semantic hand evidence plus adaptive color prototypes weights existing DINO patches; original pixels and alpha retained':'Strong hand-dominated evidence gets weight 0.1; ambiguous/product regions retain weight 1. Existing DINO patch features; original pixels and alpha retained',originalsUnchanged,attempts,negatives,note:'Scores are not identity probabilities. This experiment has no acceptance threshold and changes no production verdict.'};
await writeFile(new URL(colorAttention?'product-color-attention-trial.json':'product-attention-trial.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({originalsUnchanged,productionEnabled:false}));
