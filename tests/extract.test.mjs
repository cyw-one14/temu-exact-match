import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const code=await readFile(new URL('../extension/extract.js',import.meta.url),'utf8');
const declarations=await readFile(new URL('../extension/structured-fields.js',import.meta.url),'utf8');
function extract(html,url){const {document}=parseHTML(html),context=vm.createContext({document,location:new URL(url),URL,Date,Map,Set,JSON,Array,String,RegExp,Boolean});vm.runInContext(declarations,context);return vm.runInContext(code,context);}
test('TEMU capture keeps all displayed products beyond the old 120 cap',()=>{
  const cards=Array.from({length:175},(_,i)=>'<article><a href="/goods.html?goods_id='+(601123456789000+i)+'"><img src="https://img.kwcdn.com/'+i+'.jpg" alt="Actual captured title '+i+'"></a><span>$5.99</span><span>'+i+' sold</span></article>').join('');
  const data=extract('<html><body>United States USD'+cards+'</body></html>','https://www.temu.com/search_result.html?search_key=gloves');assert.equal(data.products.length,175);assert.equal(data.products[174].title,'Actual captured title 174');assert.match(data.products[174].rawText,/174 sold/);
});

test('reads actual DOM product links, image URLs, price and sold text without counting neighboring cards',()=>{
  const html='<html lang="en"><head><title>Search</title></head><body><header>Ship to United States USD</header><main><article><a href="/blue-bottle-g-601123456789001.html"><img src="https://img.kwcdn.com/blue.jpg" alt="Blue folding bottle"><span>Blue folding bottle</span></a><span>$5.99</span><span>10K+ sold</span><span>400 reviews</span></article><article><a href="/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/red.jpg" alt="Red bottle"><span>Red bottle</span></a><span>$4.50</span><span>2K+ sold</span></article><a href="https://external.example/goods.html?goods_id=601123456789003"><img src="https://img.kwcdn.com/not-a-temu-product.jpg" alt="Other"></a></main></body></html>';
  const data=extract(html,'https://www.temu.com/search_result.html?search_key=bottle');
  assert.equal(data.products.length,2);assert.equal(data.market,'us');
  assert.match(data.products[0].rawText,/10K\+ sold/);assert.doesNotMatch(data.products[0].rawText,/2K\+ sold/);
  assert.equal(data.products[0].url,'https://www.temu.com/goods.html?goods_id=601123456789001');
});
test('security-verification pages return an explicit challenge state',()=>{
  const data=extract('<html><head><title>Security</title></head><body>Verify you are human</body></html>','https://www.temu.com/bgn_verification.html');
  assert.equal(data.challenge,true);assert.equal(data.products.length,0);
});
test('multi-SKU product pages retain uncertainty instead of silently confirming a variant',()=>{
  const html='<html><body><main><h1>Blue folding bottle</h1><img src="https://img.kwcdn.com/blue.jpg" alt="Blue bottle"><p>Material: silicone 10K+ sold</p><button role="radio">Blue 500ml</button><button role="radio">Red 750ml</button></main></body></html>';
  const data=extract(html,'https://www.temu.com/goods.html?goods_id=601123456789001');
  assert.equal(data.detail.variantAmbiguous,true);assert.match(data.detail.detailsText,/silicone/);
});

test('detail keywords come from the matching product rather than another product on the page',()=>{
  const html='<html><body><main><h1>Green gloves</h1><img src="https://img.kwcdn.com/a.jpg"><script type="application/ld+json">[{"@type":"Product","url":"https://www.temu.com/goods.html?goods_id=601123456789002","keywords":"unrelated seller words"},{"@type":"Product","url":"https://www.temu.com/goods.html?goods_id=601123456789001","keywords":"green gloves, kitchen cleaning gloves"}]</script></main></body></html>';
  const detail=extract(html,'https://www.temu.com/goods.html?goods_id=601123456789001').detail;
  assert.equal(detail.productKeywords.length,2);assert.equal(detail.productKeywords[0].query,'green gloves');assert.equal(detail.productKeywords[0].productId,detail.id);
});

test('matching product structured specs preserve actual field evidence for automatic comparison',()=>{
  const data=extract('<html><body><main><h1>Acme bottle</h1><img src="https://img.kwcdn.com/a.jpg"><script type="application/ld+json">{"@type":"Product","brand":{"name":"Acme"},"model":"A12","additionalProperty":[{"name":"Material","value":"silicone"},{"name":"Capacity","value":"500ml"},{"name":"Quantity","value":"1pc"}]}</script></main></body></html>','https://www.temu.com/goods.html?goods_id=601123456789001');
  assert.equal(data.detail.structuredSpecs.dimensions,'500ml');assert.equal(data.detail.structuredSpecs.brand,'Acme');assert.match(data.detail.detailsText,/Quantity: 1pc/);
});

test('current prices exclude struck original amounts and coupon discounts, and preserve the complete product title',()=>{
  const title='Long original listing title '.repeat(25).trim();
  const html='<html><body><main><h1>'+title+'</h1><img src="https://img.kwcdn.com/a.jpg"><s>$19.99</s><div class="coupon"><span>$10.00</span></div><span class="current-price">$5.99</span></main></body></html>';
  const detail=extract(html,'https://www.temu.com/goods.html?goods_id=601123456789001').detail;
  assert.equal(detail.title,title);assert.equal(detail.priceText,'$5.99');
});

test('explicit title pack quantities and estimated price qualifiers remain attached to the product data',()=>{
  const detail=extract('<html><body><main><h1>3 pairs green cleaning gloves</h1><img src="https://img.kwcdn.com/a.jpg"><div>预估 <span>$3.76</span></div></main></body></html>','https://www.temu.com/goods.html?goods_id=601123456789001').detail;
  assert.equal(detail.structuredSpecs.quantity,'3 pairs');assert.equal(detail.priceText,'预估 $3.76');
});
