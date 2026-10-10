import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const code=await readFile(new URL('../extension/structured-fields.js',import.meta.url),'utf8');
function collect(html,url='https://www.temu.com/search_result.html'){
 const {document}=parseHTML(html),context=vm.createContext({document,location:new URL(url),URL,Map,Set,JSON,Array,String});vm.runInContext(code,context);return vm.runInContext('temuDeclaredProducts()',context);
}
test('public declarations remain keyed to actual product URL and do not substitute SKU/shop name or account app state for model/brand',()=>{
 const html='<html><body><script type="application/json">{"token":"DO_NOT_READ","brand":"wrong account brand"}</script><script type="application/ld+json">{"@graph":[{"@type":"Product","url":"https://www.temu.com/goods.html?goods_id=601123456789001","brand":{"name":"Actual Brand"},"model":"G22","sku":"not-a-model","numberOfItems":22,"image":["https://img.kwcdn.com/a.jpg","https://attacker.example/x.jpg"],"additionalProperty":[{"name":"Material","value":"latex"}]},{"@type":"Product","url":"https://www.temu.com/goods.html?goods_id=601123456789002","brand":"Other Brand","sku":"601123456789002","image":"https://img.kwcdn.com/b.jpg"}]}</script></body></html>';
 const map=collect(html),a=map.get('601123456789001'),b=map.get('601123456789002');
 assert.equal(a.fields.find(field=>field.label==='Brand').value,'Actual Brand');assert.equal(a.fields.find(field=>field.label==='Model').value,'G22');assert.equal(a.fields.find(field=>field.label==='Quantity').value,'22');assert.equal(a.fields.find(field=>field.label==='Material').value,'latex');assert.deepEqual(Array.from(a.images),['https://img.kwcdn.com/a.jpg']);
 assert.equal(b.fields.some(field=>field.label==='Model'),false);assert.equal(a.fields.some(field=>field.value==='Other Brand'||field.value.includes('DO_NOT_READ')),false);
});
test('missing URLs bind only to a unique matching current product declaration; ambiguous or unrelated products cannot supply fields',()=>{
 const url='https://www.temu.com/goods.html?goods_id=601123456789001';
 assert.equal(collect('<html><body><h1>Green Gloves</h1><script type="application/ld+json">[{"@type":"Product","name":"Green Gloves","brand":"A"},{"@type":"Product","name":"Green Gloves","brand":"B"}]</script></body></html>',url).size,0);
 assert.equal(collect('<html><body><h1>Green Gloves</h1><script type="application/ld+json">{"@type":"Product","name":"Other Product","brand":"Wrong"}</script></body></html>',url).size,0);
 const map=collect('<html><body><h1>Green Gloves</h1><script type="application/ld+json">{"@type":"Product","name":"Green Gloves","brand":"Right"}</script></body></html>',url);assert.equal(map.get('601123456789001').fields[0].value,'Right');
});
test('visible product gallery and public microdata are scoped to the current goods, never recommendations or neighboring nested products',()=>{
 const url='https://www.temu.com/goods.html?goods_id=601123456789001';
 const html='<html><body><h1>Green Gloves</h1><main><div itemscope itemtype="https://schema.org/Product" itemid="'+url+'"><span itemprop="brand" itemscope><meta itemprop="name" content="Glove Brand"></span><meta itemprop="model" content="G22"><meta itemprop="material" content="latex"></div><div data-product-id="601123456789001"><div data-product-gallery><img src="https://img.kwcdn.com/main.jpg"><img src="https://img.kwcdn.com/back.jpg"></div></div><section><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/unrelated.jpg"></a></section></main></body></html>';
 const data=collect(html,url).get('601123456789001');assert.equal(data.fields.find(field=>field.label==='Brand').value,'Glove Brand');assert.equal(data.fields.find(field=>field.label==='Model').value,'G22');assert.deepEqual(Array.from(data.images),['https://img.kwcdn.com/main.jpg','https://img.kwcdn.com/back.jpg']);assert.equal(data.imageSource,'bound-current-product-gallery');
 const bad=collect('<html><body><h1>Gloves</h1><div data-product-gallery><a href="https://www.temu.com/goods.html?goods_id=601123456789002"><img src="https://img.kwcdn.com/other.jpg"></a><img src="https://img.kwcdn.com/other2.jpg"></div></body></html>',url);assert.equal(bad.size,0);
});
