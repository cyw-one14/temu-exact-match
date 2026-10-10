import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSales,decideExact,decideProductMatch,localSpecChecks,rankExact,temuProductUrl,keywordMetrics,bestSellerKeywords,listingKeywordEvidence,listingSpecs,specConflict} from '../shared/core.mjs';
const specs={brand:'Acme',model:'A12',material:'silicone',dimensions:'500ml',quantity:'1pc'};
const source='Brand: Acme; Model: A12; Material: silicone; Capacity: 500ml; Quantity: 1pc';
const comparison={visual:'same_photo',differences:[],checks:localSpecChecks(specs,source)};

test('review counts and stock hints are not interpreted as sales',()=>{
  assert.equal(parseSales('4.8 stars, 1,204 reviews, only 3 left').lowerBound,null);
});
test('visible sales preserve exact, lower-bound, approximate and reporting-window distinctions',()=>{
  assert.equal(parseSales('10K+ sold').lowerBound,10000);
  assert.equal(parseSales('10K+ sold').exact,false);
  assert.equal(parseSales('4.2K sold').kind,'approximate');
  assert.equal(parseSales('4.2K sold').lowerBound,null);
  assert.equal(parseSales('1,204 sold in the past 30 days').period,'30d');
  assert.equal(parseSales('sold 1,204').exact,true);
});
test('an identical photo alone cannot prove exact product identity',()=>{
  assert.equal(decideExact({visual:'same_photo',checks:[]},{}).status,'pending');
});

test('reference specs are read from labeled or structured product values without inventing hidden attributes',()=>{
  assert.deepEqual(listingSpecs(source).specs,specs);
  assert.deepEqual(listingSpecs('A blue bottle with 300 reviews').specs,{});
  const conflict=listingSpecs('Material: silicone; Material: latex; Brand: Acme',{material:'silicone'});
  assert.equal(conflict.specs.material,undefined);assert.equal(conflict.specs.brand,'Acme');
  assert.equal(localSpecChecks(specs,source+'; Material: latex').find(item=>item.key==='material').status,'unknown');
});
test('missing details and conflicting product specifications cannot enter the exact ranking',()=>{
  assert.equal(decideExact(comparison,specs,source).status,'exact');
  assert.equal(decideExact(comparison,specs,'Reviews describe Acme A12 silicone 500ml 1pc').status,'pending');
  assert.equal(decideExact({...comparison,visual:'uncertain'},specs,source).status,'pending');
  assert.equal(decideExact({...comparison,differences:['the cap has a different shape']},specs,source).status,'different');
});
test('model and quantity values cannot match substrings of different specifications',()=>{
  const misleading='Brand: Acme; Model: A123; Material: silicone; Capacity: 500ml; Quantity: 11pc';
  const checked=localSpecChecks(specs,misleading);
  assert.equal(checked.find(item=>item.key==='model').status,'unknown');
  assert.equal(checked.find(item=>item.key==='quantity').status,'unknown');
  assert.equal(decideExact(comparison,specs,misleading).status,'pending');
  assert.equal(localSpecChecks(specs,source.replace('A12;','A12-B;')).find(item=>item.key==='model').status,'unknown');
});
test('same-looking products and mixed reporting periods are excluded from one sales cohort',()=>{
  const items=[{id:'a',status:'exact',market:'us',sales:parseSales('100 sold in past 30 days')},{id:'b',status:'pending',market:'us',sales:parseSales('100K+ sold')},{id:'c',status:'exact',market:'us',sales:parseSales('200 sold in past 30 days')},{id:'d',status:'exact',market:'us',sales:parseSales('999 sold')}];
  const ranked=rankExact(items);assert.deepEqual(ranked.map(x=>x.id),['c','a','d']);assert.notEqual(ranked[0].salesCohort,ranked[2].salesCohort);
});
test('only TEMU public product links are allowed',()=>{
  assert.equal(temuProductUrl('https://www.temu.com/example-g-601123456789123.html').id,'601123456789123');
  assert.equal(temuProductUrl('https://attacker.example/goods.html?goods_id=601123456789123'),null);
  assert.equal(temuProductUrl('javascript:alert(1)'),null);
});
test('keywords are validated by confirmed match counts, not fabricated search volume',()=>{
  const metrics=keywordMetrics(['bottle','blue bottle'],[{status:'pending',queries:['bottle']},{status:'exact',queries:['blue bottle']}]);
  assert.equal(metrics[0].query,'blue bottle');assert.equal(metrics[0].exactCount,1);
});

test('an explicit top-three limit retains literal product evidence and excludes lower sellers',()=>{
  const item=(id,sales,status='exact')=>({id,title:'Literal '+id+' gloves, Waterproof cleaning gloves',status,market:'us',url:'https://www.temu.com/goods.html?goods_id='+id,sales:parseSales(sales+' sold')});
  const products=[item('low',10),item('second',900),item('leader',1000),item('third',500),item('pending',999999,'pending'),item('missing',''),item('different',888888,'different')];
  products[2].productKeywords=[{query:'Seller actual phrase',productId:'leader',pageUrl:products[2].url,evidence:'关键词：Seller actual phrase'},{query:'Unrelated word',productId:'other',pageUrl:products[2].url,evidence:'irrelevant'}];
  const [group]=bestSellerKeywords(products,3);
  assert.deepEqual(group.products.map(value=>value.id),['leader','second','third']);
  assert.equal(group.keywords[0].query,'Seller actual phrase');
  assert.equal(group.keywords[0].sources[0].rank,1);
  assert.equal(group.keywords[0].sources[0].kind,'product-keyword');
  assert.equal(group.keywords.some(word=>word.query.includes('low')||word.query==='Unrelated word'),false);
  for(const word of group.keywords)for(const source of word.sources){assert.ok(source.evidence.includes(word.query));assert.ok(source.url);}
  assert.equal(group.keywords.find(word=>word.query==='Waterproof cleaning gloves').sources.length,2);
});

test('page wording variants cannot exclude a product whose photo evidence already matches',()=>{
  const photo=(specs,text)=>decideProductMatch({visual:'same_photo',differences:[],checks:localSpecChecks(specs,text)},specs,text);
  assert.equal(specConflict('material','silicone','Food Grade Silicone'),'unverified');
  assert.equal(specConflict('brand','No Name','other'),'unverified');
  assert.equal(specConflict('dimensions','500ml','500ml/16.9oz'),null);
  assert.equal(specConflict('dimensions','18x12cm','18*12cm'),null);
  assert.equal(specConflict('dimensions','500ml','12cm'),'unverified');
  assert.equal(specConflict('model','A12','A12-B'),'unverified');
  assert.equal(specConflict('quantity','4','12 Pack'),'unverified');
  assert.equal(photo({material:'silicone'},'Material: Food Grade Silicone').status,'visual-match');
  assert.equal(photo({material:'silicone'},'Material: Food Grade Silicone').missing.some(value=>value.includes('材质页面显示不同')&&value.includes('不参与同款判断')),true);
  assert.equal(photo({dimensions:'500ml'},'Capacity: 500ml/16.9oz').status,'visual-match');
  assert.equal(decideProductMatch({visual:'uncertain',differences:[],checks:[]},{material:'silicone'},'Material: Food Grade Silicone').status,'pending');
});

test('specification differences remain page annotations independent of image-subject identity',()=>{
  assert.equal(specConflict('quantity','1pc','4pcs'),'different');
  assert.equal(specConflict('quantity','3 pairs','1 pair'),'different');
  assert.equal(specConflict('quantity','4pcs','Quantity 4 pieces'),null);
  assert.equal(specConflict('quantity','4pcs','1pc/2pcs/4pcs'),'unverified');
  assert.equal(specConflict('dimensions','500ml','1L'),'different');
  assert.equal(specConflict('dimensions','0.5 L','500ml'),null);
  assert.equal(specConflict('dimensions','18x12cm','18x30cm'),'different');
  assert.equal(specConflict('model','A12','B77'),'different');
  assert.equal(specConflict('model','Acme A12','A12'),'unverified');
  assert.equal(specConflict('brand','Acme','Zhejiang Factory'),'unverified');
  const photo={visual:'same_photo',differences:[],checks:[]};
  assert.equal(decideProductMatch(photo,{quantity:'1pc'},'Quantity: 4pcs').status,'visual-match');
  assert.equal(decideProductMatch(photo,{quantity:'1pc'},'Quantity: 4pcs').missing.some(value=>value.includes('售卖数量不同')),true);
  assert.equal(decideProductMatch({...photo,visual:'uncertain'},{quantity:'1pc'},'Quantity: 4pcs').status,'pending');
  assert.equal(decideProductMatch({visual:'uncertain',subject:{matched:true},differences:[],checks:[]},{quantity:'1pc'},'Quantity: 4pcs').status,'visual-match');
  assert.equal(decideProductMatch(photo,{dimensions:'500ml'},'Capacity: 1L').status,'visual-match');
  assert.equal(decideProductMatch({...photo,subject:{matched:false}},{'model':'A12'},'Model: B77').status,'visual-match');
});

test('a quantity-different check cannot exclude an image-confirmed product, but genuine shape differences still do',()=>{
  const image={visual:'uncertain',subject:{matched:true},differences:[],checks:[{key:'quantity',status:'different',candidateValue:'2pcs',evidence:'Quantity: 2pcs'}]};
  const result=decideProductMatch(image,{quantity:'1pc'},'Quantity: 2pcs');
  assert.equal(result.status,'visual-match');assert.deepEqual(result.packDifference,{reference:'1pc',candidate:'2pcs',source:'listing'});
  assert.equal(decideProductMatch({...image,visual:'different',differences:['different comb tooth shape']},{quantity:'1pc'},'Quantity: 2pcs').status,'different');
});

test('seller keyword rankings separate markets and periods and retain approximate sales as labeled values',()=>{
  const item=(id,market,period,count)=>({id,status:'exact',market,title:'Original seller words',sales:{...parseSales(count+' sold'),period}});
  const groups=bestSellerKeywords([item('approx','us','30d','4.2K'),item('small','us','30d','20'),item('monthly','us','month','99999'),item('other','unverified','30d','800000')]);
  assert.equal(groups.length,3);assert.equal(groups[0].products[0].id,'approx');assert.equal(groups[0].keywords[0].sources[0].sales.kind,'approximate');
  assert.deepEqual(bestSellerKeywords([{status:'exact',title:'No sales title',sales:parseSales('')}]),[]);
  assert.deepEqual(bestSellerKeywords([{status:'pending',title:'No match title',sales:parseSales('100 sold')}]),[]);
});

test('default Top10 retains no-keyword sellers, stable ties, zero and sales uncertainty within separate cohorts',()=>{
  const item=(id,count,extra={})=>({id,url:'https://www.temu.com/goods.html?goods_id='+id,title:'Literal seller '+id,status:'visual-match',market:'us',sales:parseSales(count+' sold'),...extra});
  const items=Array.from({length:12},(_,i)=>item('seller-'+i,100-i));
  items[0].title='';items[1].sales=parseSales('99+ sold');items[2].sales=parseSales('0.099K sold');items[3].status='rule-match';
  items.push(item('unknown',''),item('pending',999999,{status:'pending'}),item('legacy',999999,{status:'inferred-match'}),item('different',999999,{status:'different'}),item('zero',0),items[4],item('provider',999,{salesSource:'provider-visible'}),item('month',999,{sales:{...parseSales('999 sold'),period:'month'}}),item('market',999,{market:'unverified'}));
  const groups=bestSellerKeywords(items),group=groups[0];
  assert.equal(groups.length,4);assert.equal(group.topCount,10);assert.equal(group.eligibleProducts,13);
  assert.deepEqual(group.products.map(x=>x.id),Array.from({length:10},(_,i)=>'seller-'+i));
  assert.deepEqual(group.products.map(x=>x.salesRank),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(group.products[0].keywordEvidence,[]);assert.equal(group.products[1].sales.kind,'lower-bound');assert.equal(group.products[2].sales.kind,'approximate');
  assert.equal(group.products[3].keywordEvidence[0].matchStatus,'rule-match');
  assert.equal(group.keywords.some(word=>word.query.includes('seller-10')),false);
  assert.equal(bestSellerKeywords([item('zero',0)])[0].products[0].sales.displayValue,0);
  assert.equal(bestSellerKeywords(items,NaN)[0].products.length,10);
});

test('per-link keywords reject mismatched IDs, invented phrases and unsafe sources while preserving literal evidence and capture time',()=>{
  const product={id:'601123456789001',title:'Original  title words, Original second clause\nThird title phrase',url:'https://www.temu.com/goods.html?goods_id=601123456789001',sourceUrl:'https://www.temaishuju.com/plugin/search-image',capturedAt:'2026-10-10T02:00:00Z',status:'rule-match',sales:parseSales('')};
  const word={query:'Seller Exact Words',productId:product.id,pageUrl:product.sourceUrl,evidence:'关键词：Seller Exact Words',capturedAt:'2026-10-10T01:00:00Z'};
  product.productKeywords=[word,{...word},{...word,productId:'other'},{...word,query:'Invented Words'},{...word,query:'Unsafe words',evidence:'Unsafe words',pageUrl:'javascript:alert(1)'}];
  const evidence=listingKeywordEvidence(product);assert.equal(evidence.length,1);assert.equal(evidence[0].query,word.query);assert.equal(evidence[0].capturedAt,word.capturedAt);assert.equal(evidence[0].matchStatus,'rule-match');assert.equal(evidence[0].pageUrl,word.pageUrl);
  product.productKeywords=[{...word,query:'Invented Words'}];
  const fallback=listingKeywordEvidence(product);assert.deepEqual(fallback.map(x=>x.query),['Original  title words','Original second clause','Third title phrase']);
  assert.ok(fallback.every(x=>x.kind==='title-phrase'&&x.evidence.includes(x.query)&&x.capturedAt===product.capturedAt));
  assert.deepEqual(bestSellerKeywords([product]),[],'unknown sales still have per-link evidence but cannot enter Top10');
  assert.deepEqual(listingKeywordEvidence({...product,title:'TEMU 商品 601123456789001'}),[]);
});
