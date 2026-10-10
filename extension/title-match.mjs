// Literal listing evidence only. These scores are shortlist rules, not identity probabilities.
const noise=new Set(('a an the and or for with of to in on from out is it this that these those all any new best premium ultra ideal reusable durable random color colours colors size sizes pcs pc pieces piece pair pairs pack packs set sets unit units non m l s xl xxl beige mint green blue red pink white black brown yellow purple orange').split(' '));
const aliases={gloves:'glove',combs:'comb',bottles:'bottle',squeezers:'squeezer',dispensers:'dispenser',holders:'holder',sandalwood:'wood',wooden:'wood',hairdressing:'hair',thickened:'thick',waterproof:'waterproof',cleanser:'cleaning',cleaning:'cleaning',clean:'cleaning',cleansing:'cleaning'};
const families=[['glove',/\bgloves?\b|手套/],['comb',/\bcombs?\b|梳子|木梳/],['bottle',/\bbottles?\b|水瓶|水壶/],['toothpaste-squeezer',/(?=.*\btoothpaste\b)(?=.*\b(?:squeezer|roller|dispenser|holder)\b)|挤牙膏|牙膏挤/],['phone-case',/(?=.*\b(?:phone|iphone)\b)(?=.*\b(?:case|cover)\b)|手机壳/],['shoe',/\b(?:shoes?|sneakers?|boots?)\b|鞋|靴/],['bag',/\b(?:bags?|backpacks?|handbags?)\b|背包|手提包/],['mug',/\b(?:mugs?|cups?)\b|杯子|水杯/]];
const normalized=value=>String(value||'').slice(0,2000).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function tokens(value){
  const text=normalized(value).replace(/\d+(?:\.\d+)?\s*[- ]?\s*(?:pcs?|pieces?|pairs?|packs?|sets?|units?|cm|mm|ml|inch(?:es)?|oz|件|双|个)\b/gi,' ');
  const words=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(text)].filter(part=>part.isWordLike).map(part=>part.segment);
  return [...new Set(words.map(word=>aliases[word]||word).filter(word=>word.length>1&&!noise.has(word)&&!/^\d+$/.test(word)))].slice(0,80);
}
function knownBrand(value){const text=normalized(value);return text&&!/^(?:unknown|unbranded|generic|none|n\/a|无品牌|未知|temu|无)$/.test(text)?text:'';}
export function titleMatchEvidence(referenceTitle,candidateTitle,referenceBrand='',candidateBrand=''){
  const a=tokens(referenceTitle),b=tokens(candidateTitle),shared=a.filter(word=>b.includes(word));
  const referenceFamily=families.find(([,pattern])=>pattern.test(normalized(referenceTitle)))?.[0]||'';
  const candidateFamily=families.find(([,pattern])=>pattern.test(normalized(candidateTitle)))?.[0]||'';
  const categoryConflict=Boolean(referenceFamily&&candidateFamily&&referenceFamily!==candidateFamily);
  const sameCategory=Boolean(referenceFamily&&referenceFamily===candidateFamily);
  const ca=shared.length/Math.max(1,a.length),cb=shared.length/Math.max(1,b.length),score=Math.sqrt(ca*cb);
  const identical=a.length>=3&&a.length===b.length&&shared.length===a.length;
  const highSimilarity=!categoryConflict&&shared.length>=3&&(identical||(Math.max(ca,cb)>=.7&&Math.min(ca,cb)>=.15)||(sameCategory&&shared.length>=4&&Math.min(ca,cb)>=.12));
  const brandA=knownBrand(referenceBrand),brandB=knownBrand(candidateBrand),sameBrand=Boolean(brandA&&brandA===brandB);
  const brandAndType=sameBrand&&sameCategory&&shared.length>=2;
  const unknown=!a.length||!b.length||(!shared.length&&!(referenceFamily&&candidateFamily));
  return {revision:'literal-title-v1',score,sharedTerms:shared,referenceFamily,candidateFamily,categoryConflict,sameCategory,sameBrand,highSimilarity,identical,
    reviewEligible:!categoryConflict&&(unknown||sameCategory||shared.length>=2),
    inferenceEligible:highSimilarity||brandAndType,basis:highSimilarity?'high-title-similarity':brandAndType?'same-brand-and-type':'',
    reason:categoryConflict?'标题显示不同商品类型，暂缓后续主体核对（不认定不同款）':highSimilarity?'商品标题关键描述高度重合':brandAndType?'明确品牌相同且标题商品类型一致':unknown?'标题证据不足，保留图片核对':'按标题关键描述筛选图片核对'};
}

export function inferListingColorMatch(titleEvidence,colorEvidence){
  const eligible=titleEvidence?.revision==='literal-title-v1'&&titleEvidence.inferenceEligible&&!titleEvidence.categoryConflict;
  const matched=Boolean(eligible&&colorEvidence?.valid&&Number.isFinite(colorEvidence.similarity)&&colorEvidence.similarity>=.85&&colorEvidence.similarity<=1.000001);
  return {matched,titleEvidence,colorEvidence,reason:matched?'标题关键描述 / 品牌商品类型相符，前景粗配色接近；推定同款，未证明结构细节一致':eligible?'前景配色未达到推定要求，继续主体特征核对':'标题 / 品牌商品类型证据不足，继续主体特征核对'};
}
