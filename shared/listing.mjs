// Literal listing annotations only. Never product-identity evidence or SKU binding.
export const LISTING_LABELS={brand:'品牌',model:'型号',material:'材质',dimensions:'尺寸 / 容量',quantity:'数量 / 套装',color:'颜色',variant:'规格描述'};
const aliases={brand:/^((?:product\s+)?brand(?:\s+name)?|品牌|品牌名称|商品品牌|产品品牌)$/i,model:/^((?:product\s+)?model(?:\s+(?:no\.?|number))?|型号|商品型号|产品型号)$/i,material:/^(material|材质)$/i,dimensions:/^(dimensions|size|capacity|尺寸|容量)$/i,quantity:/^(quantity|number of pieces|pack quantity|数量|套装数量)$/i,color:/^(colou?r|颜色|色彩)$/i,variant:/^(specifications?|specs|规格|规格描述|产品规格)$/i};
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const labels='brand|model|material|dimensions|size|capacity|quantity|number of pieces|pack quantity|colou?r|specifications?|specs|品牌|型号|材质|尺寸|容量|数量|套装数量|颜色|规格描述|规格';
export function listingMetadata({title='',text='',structuredSpecs={},listingFields=[],sourceUrl='',capturedAt=''}={}){
  title=String(title||'');text=String(text||'');structuredSpecs=structuredSpecs&&typeof structuredSpecs==='object'?structuredSpecs:{};listingFields=Array.isArray(listingFields)?listingFields:[];
  const values=new Map(Object.keys(LISTING_LABELS).map(key=>[key,[]]));
  const add=(key,value,evidence,source,ambiguous=false,evidenceUrl=sourceUrl)=>{value=String(value??'').trim();if(value&&value.length<=200)values.get(key).push({value,evidence:String(evidence).trim(),source,ambiguous,sourceUrl:evidenceUrl});};
  for(const key of values.keys())if(['string','number'].includes(typeof structuredSpecs[key]))add(key,structuredSpecs[key],String(structuredSpecs[key]),'structured-product');
  for(const field of listingFields)for(const [key,pattern]of Object.entries(aliases))if(pattern.test(String(field.label||'').trim()))add(key,field.value,field.label+': '+field.value,['public-jsonld','public-microdata'].includes(field.source)?field.source:'visible-field',false,field.sourceUrl||sourceUrl);
  // Captured card text is often flattened; stop at the next explicit field/price.
  const pattern=new RegExp('(?<![\\p{L}\\p{N}])('+labels+')\\s*[:：]\\s*(.{1,200}?)(?=\\s*(?:[;；\\n]|(?:'+labels+')\\s*[:：]|(?:price|sold|销量|已售出)\\s*[:：]|[$€£¥￥])|$)','giu');
  for(const match of String(text).matchAll(pattern))for(const [key,alias]of Object.entries(aliases))if(alias.test(match[1]))add(key,match[2],match[0],'listing-text');
  const counts=[...String(title).matchAll(/(?<![\d.])(\d{1,4})\s*[- ]?\s*((?:pcs?|pieces?|units?|packs?|pairs?)(?![\p{L}\p{N}])|(?:双|件|个)(?![\d]|月|天|小时|颜色|款式))/giu)];
  if(counts.length){
    const start=counts[0].index;let end=counts.at(-1).index+counts.at(-1)[0].length;
    if(/^\s*\)/.test(title.slice(end)))end+=title.slice(end).match(/^\s*\)/)[0].length;
    const span=title.slice(start,end);
    // Retain a literal piece/pair compound, e.g. 22pcs (11 Pairs). No unit-price
    // conversion or selected-variant inference is made from these title counts.
    const forms=new Set(counts.map(match=>Number(match[1])+' '+(/^(pairs?|双)$/i.test(match[2])?'pair':'pc')));
    const pair=counts.find(match=>/^(?:pairs?|双)$/i.test(match[2])),pieces=counts.find(match=>/^(?:pcs?|pieces?|件|个)$/i.test(match[2]));
    const compound=counts.length===2&&pair&&pieces&&Number(pair[1])*2===Number(pieces[1])&&/^[\s(/-]*$/.test(title.slice(counts[0].index+counts[0][0].length,counts[1].index));
    add('quantity',span,title,'title-literal',forms.size>1&&!compound);
  }
  const materials=[...title.matchAll(/\b(?:stainless steel|natural sandalwood|sandalwood|silicone|latex|rubber|PVC|TPU|cotton|nylon|polyester|wood(?:en)?|plastic)\b|硅胶|乳胶|橡胶|不锈钢|塑料|檀木|木制|棉质/gi)];
  if(materials.length){const unique=[...new Set(materials.map(match=>normalized(match[0])))];add('material',unique.length===1?materials[0][0]:materials.map(match=>match[0]).join(' / '),title,'title-literal',unique.length>1);}
  const size=title.match(/\bsize\s*[:：-]?\s*(?:XXXL|XXL|XL|XS|S|M|L)(?:\s*[/,]\s*(?:XXXL|XXL|XL|XS|S|M|L))*\b|尺寸\s*[:：]?\s*(?:XXXL|XXL|XL|XS|S|M|L)\b/i);
  const measures=[...title.matchAll(/(?<![\d.])\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?){0,2}\s*(?:fl\s*oz|inches?|cm|mm|ml|liters?|kg|oz|厘米|毫米|毫升)(?![\p{L}\p{N}])/giu)];
  if(size)add('dimensions',size[0],title,'title-literal',/[/,]/.test(size[0]));
  else if(measures.length)add('dimensions',measures.map(match=>match[0]).join(' / '),title,'title-literal',measures.length>1);
  const random=title.match(/random\s+colou?r|随机颜色|随机色/i);
  const colors=[...title.matchAll(/\b(?:mint green|light green|dark green|rose gold|beige|green|white|black|pink|red|blue|yellow|brown|grey|gray|purple|orange|silver|gold)\b|薄荷绿|米色|绿色|白色|黑色|粉色|红色|蓝色|黄色|棕色/gi)];
  if(random)add('color',random[0],title,'title-literal',true);
  else if(colors.length)add('color',title.slice(colors[0].index,colors.at(-1).index+colors.at(-1)[0].length),title,'title-literal',false);
  const fields={};
  for(const [key,entries]of values){
    // Labeled/structured fields are stronger than title marketing. Both remain
    // available as evidence, and explicit title contradictions remain visible.
    const explicit=entries.filter(item=>item.source!=='title-literal'),chosen=explicit.length?explicit:entries;
    const unique=[...new Set(chosen.map(item=>normalized(item.value)))];
    const ambiguous=chosen.some(item=>item.ambiguous)||unique.length>1;
    fields[key]={value:chosen[0]?.value||'',status:!chosen.length?'not-shown':ambiguous?'options':'listed',source:chosen[0]?.source||'not-shown',evidence:chosen,otherTitleEvidence:explicit.length?entries.filter(item=>item.source==='title-literal'):[],skuBound:false};
  }
  return {fields,sourceUrl,capturedAt,skuBound:false};
}
