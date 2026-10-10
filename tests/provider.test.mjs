import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {providerSearchURL,providerSales,normalizeProviderPage} from '../shared/provider.mjs';
import {rankExact} from '../shared/core.mjs';
const source=await readFile(new URL('../extension/provider-extract.js',import.meta.url),'utf8');
function extract(html,url='https://www.temaishuju.com/plugin/search-image?url=https%3A%2F%2Fimg.kwcdn.com%2Fa.jpg'){
  const {document}=parseHTML(html);return vm.runInNewContext(source,{document,location:new URL(url),URL,Date,Map,Set,String,Array,RegExp});
}
test('provider navigation encodes image URLs without sending base64 or guessing region codes',()=>{
  const url=new URL(providerSearchURL({imageUrl:'https://img.kwcdn.com/a.jpg?x=1&y=2',productId:'601123456789001',title:'A & B'}));
  assert.equal(url.searchParams.get('url'),'https://img.kwcdn.com/a.jpg?x=1&y=2');assert.equal(url.searchParams.get('title'),'A & B');assert.equal(url.searchParams.has('region'),false);
  assert.equal(url.searchParams.get('platform'),'temu');
  assert.throws(()=>providerSearchURL({imageUrl:'https://img.kwcdn.com.attacker.example/a.jpg'}));
});
test('provider sales preserve their labeled windows and reject reviews, growth and revenue',()=>{
  const data=providerSales([{label:'月销量',value:'1,204'},{label:'周销量',value:'4.2K'},{label:'总销量',value:'10K+'},{label:'评价数',value:'1000'},{label:'销售额',value:'$1200'},{label:'月销量增长',value:'80%'}]);
  assert.deepEqual(data.map(value=>value.period),['month','week','total']);assert.equal(data[0].exact,true);assert.equal(data[1].lowerBound,null);assert.equal(data[2].lowerBound,10000);
  const windows=providerSales([{label:'近30天销量',value:'300'},{label:'月销量',value:'1000'},{label:'近31日销量',value:'500'},{label:'今日销量',value:'12'}]);assert.deepEqual(windows.map(item=>item.period),['30d','month','unknown','today']);
});
test('missing monthly sales cannot silently fall back to weekly sales',()=>{
  const normalized=normalizeProviderPage({pageUrl:'https://www.temaishuju.com/plugin/search-image',products:[{url:'https://www.temu.com/goods.html?goods_id=601123456789001',salesFields:[{label:'周销量',value:'9000'}]}]},'30d');
  assert.equal(normalized.products[0].sales.lowerBound,null);assert.equal(normalized.products[0].sales.period,'30d');assert.equal(normalized.products[0].status,'pending');assert.equal(normalized.products[0].market,'unverified');
});
test('the visible provider table supplies product sales and keyword metrics without cross-contaminating rows',()=>{
  const html='<html><body><p>当前站点：美国</p><table><thead><tr><th>商品信息</th><th>月销量</th><th>周销量</th><th>评价数</th></tr></thead><tbody><tr><td><a href="https://www.temu.com/goods.html?goods_id=601123456789001"><img src="https://img.kwcdn.com/a.jpg" alt="Blue bottle">Blue bottle</a></td><td>1204</td><td>300</td><td>99999</td></tr><tr><td><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/b.jpg" alt="Red bottle">Red bottle</a></td><td>20</td><td>8</td><td>100</td></tr><tr hidden><td><a href="https://www.temu.com/goods.html?goods_id=601123456789003"><img src="https://img.kwcdn.com/c.jpg">Hidden</a></td><td>999999</td></tr></tbody></table><table><thead><tr><th>关键词</th><th>搜索量</th></tr></thead><tbody><tr><td>blue bottle</td><td>页面数值 500</td></tr></tbody></table></body></html>';
  const page=extract(html);assert.equal(page.state,'results');assert.equal(page.products.length,2);assert.equal(page.products[0].market,'us');assert.doesNotMatch(page.products[0].rawText,/Red bottle/);
  const normalized=normalizeProviderPage(page,'month');assert.equal(normalized.products[0].sales.lowerBound,1204);assert.equal(normalized.products[1].sales.lowerBound,20);assert.equal(normalized.keywords[0].query,'blue bottle');assert.equal(normalized.keywords[0].metrics[0].value,'页面数值 500');
});
test('login, access denial and empty-result pages do not produce invented products',()=>{
  assert.equal(extract('<html><body>Please login</body></html>','https://www.temaishuju.com/login').state,'login');
  const challenge=extract('<html><body>403 Forbidden</body></html>');assert.equal(challenge.state,'challenge');assert.equal(challenge.products.length,0);
  assert.equal(extract('<html><body>暂无数据</body></html>').state,'empty');
  assert.equal(extract('<html><body><div role="tab" aria-selected="true">淘宝</div></body></html>').state,'unsupported');
});
test('TEMU grid cards preserve visible sold labels as unknown-period sales and use the card title',()=>{
  const page=extract('<html><body><div class="list"><a class="list-item" href="https://www.temu.com/blue-g-601123456789001.html"><img class="thumb" src="https://img.kwcdn.com/a.jpg"><div class="title">Blue bottle</div><div class="price-wrap"><span>$5.00</span><span class="sold">已售出 1.2K 件</span></div><div class="location">评分 4.5 (100)</div></a><a class="list-item" href="https://www.temu.com/red-g-601123456789002.html"><img src="https://img.kwcdn.com/b.jpg"><div class="title">Red bottle</div><span class="sold">已售出 90 件</span></a></div></body></html>');
  const normalized=normalizeProviderPage(page,'unknown');assert.equal(normalized.products.length,2);assert.equal(normalized.products[0].title,'Blue bottle');assert.equal(normalized.products[0].sales.period,'unknown');assert.equal(normalized.products[0].sales.kind,'approximate');assert.equal(normalized.products[1].sales.lowerBound,90);
});
test('third-party sales and TEMU visible sales never share one ranking cohort',()=>{
  const entries=[{id:'temu',status:'exact',market:'us',sales:{period:'30d',lowerBound:10}},{id:'provider',status:'exact',market:'us',salesSource:'provider-visible',sales:{period:'30d',lowerBound:10000}}];
  const ranked=rankExact(entries);assert.notEqual(ranked[0].salesCohort,ranked[1].salesCohort);
});

test('product keywords retain their own row identity while page-wide words stay unassociated',()=>{
  const page=extract('<html><body><table><thead><tr><th>商品信息</th><th>销量</th><th>关键词</th></tr></thead><tbody><tr><td><a href="https://www.temu.com/goods.html?goods_id=601123456789001"><img src="https://img.kwcdn.com/a.jpg">Green glove</a></td><td>300</td><td>green cleaning gloves, waterproof gloves</td></tr><tr><td><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/b.jpg">Other glove</a></td><td>10</td><td>other seller keyword</td></tr></tbody></table><section><h3>推荐关键词</h3><span data-keyword="global unrelated keyword">global unrelated keyword</span></section></body></html>');
  const normalized=normalizeProviderPage(page);
  const words=normalized.products[0].productKeywords;
  assert.ok(words.some(word=>word.query==='green cleaning gloves'));assert.ok(words.every(word=>word.productId==='601123456789001'));assert.ok(words.every(word=>word.evidence.includes(word.query)));
  assert.equal(words.some(word=>/other seller|global unrelated/.test(word.query)),false);
});

test('provider card prices use the actual price container instead of struck prices or unrelated dollar amounts',()=>{
  const page=extract('<html><body><p>当前站点：美国</p><a class="list-item" href="https://www.temu.com/glove-g-601123456789001.html"><img src="https://img.kwcdn.com/a.jpg"><div class="title">Original glove title</div><s>$99.00</s><div class="price-wrap"><span>$5.99</span><span class="sold">已售出 100 件</span></div></a></body></html>');
  const [product]=normalizeProviderPage(page).products;assert.equal(product.priceText,'$5.99');assert.equal(product.price.currency,'USD');assert.equal(product.price.kind,'displayed');
});

test('split currency digits, price ranges and conditional prices remain attached to the correct product',()=>{
  const card=price=>'<html><body><p>当前站点：美国</p><a class="list-item" href="https://www.temu.com/glove-g-601123456789001.html"><img src="https://img.kwcdn.com/a.jpg"><div class="title">Exact original title</div>'+price+'</a></body></html>';
  const first=normalizeProviderPage(extract(card('<div class="price-wrap"><s>$99</s><span>$</span><span>5</span><span>.99</span><span class="sold">已售出 100 件</span></div>'))).products[0];
  assert.equal(first.priceText,'$5.99');assert.equal(first.price.low,5.99);
  const range=normalizeProviderPage(extract(card('<div class="price"><span>$</span><span>3.76</span><span> – </span><span>4.85</span></div>'))).products[0];
  assert.equal(range.price.kind,'range');assert.equal(range.price.high,4.85);
  const estimate=normalizeProviderPage(extract(card('<div>预估价<div class="sale-price"><span>$</span><span>3.76</span></div></div>'))).products[0];
  assert.equal(estimate.price.kind,'conditional');
  const coupon=normalizeProviderPage(extract(card('<div class="coupon"><span>$3.00</span></div><div class="original-price">$99.00</div>'))).products[0];
  assert.equal(coupon.price.kind,'unknown');
  const numeric=normalizeProviderPage(extract(card('<div class="price"><span>5</span><span>.99</span></div>'))).products[0];
  assert.equal(numeric.price.low,5.99);assert.equal(numeric.price.currency,'');
  const screenshot=normalizeProviderPage(extract(card('<div class="price-wrap"><span class="price"><span>$ </span><span>$1.68</span></span><span class="sold">已售出 485 件</span></div>'))).products[0];
  assert.equal(screenshot.priceText,'$1.68');assert.equal(screenshot.price.low,1.68);
});
