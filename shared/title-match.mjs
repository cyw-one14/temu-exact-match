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
  const unknown=!a.length||!b.length||(!shared.length&&!(referenceFamily&&candidateFamily));
  const similar=!categoryConflict&&(highSimilarity||(shared.length>=2&&score>=.35));
  const group=similar?'similar':unknown?'unknown':'dissimilar';
  return {revision:'literal-title-v2',score,sharedTerms:shared,referenceFamily,candidateFamily,categoryConflict,sameCategory,sameBrand,highSimilarity,identical,similar,group,
    reviewEligible:true,inferenceEligible:similar,basis:similar?'similar-title':'',
    reason:similar?'标题相似组：先核对主体，未匹配时可用主体颜色补充判断':unknown?'标题证据不足：仍核对主体，不使用颜色单独放行':'标题不相似组：仍核对主体，主体一致即为同款'};
}

export function inferListingColorMatch(titleEvidence,colorEvidence,subjectReview={}){
  const eligible=titleEvidence?.revision==='literal-title-v2'&&titleEvidence.group==='similar'&&subjectReview.completed===true&&subjectReview.matched===false;
  const matched=Boolean(eligible&&colorEvidence?.valid&&Number.isFinite(colorEvidence.similarity)&&colorEvidence.similarity>=.85&&colorEvidence.similarity<=1.000001);
  return {matched,titleEvidence,colorEvidence,subjectReview,reason:matched?'主体未匹配，但标题相似且主体关注区域颜色相近，按用户规则归为同款':eligible?(colorEvidence?.valid?'主体颜色不够接近，仍无法确认同款':'主体颜色未可靠读取，不能按颜色放行'):'仅标题相似组在主体核对完成且未匹配后允许颜色补充判断'};
}
