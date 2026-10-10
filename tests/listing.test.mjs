import test from 'node:test';
import assert from 'node:assert/strict';
import {listingMetadata} from '../shared/listing.mjs';
import {localSpecChecks} from '../shared/core.mjs';

test('red-box glove titles preserve literal quantities/material/color without making up brand/model or a selected SKU',()=>{
  const info=listingMetadata({title:'22pcs (11Pairs) Random Color Thick Latex Kitchen Gloves - Beige and Mint Green'});
  assert.equal(info.fields.quantity.value,'22pcs (11Pairs)');assert.equal(info.fields.quantity.status,'listed');
  assert.equal(info.fields.material.value,'Latex');assert.equal(info.fields.color.value,'Random Color');
  assert.equal(info.fields.color.status,'options');assert.equal(info.fields.brand.status,'not-shown');assert.equal(info.fields.model.status,'not-shown');assert.equal(info.skuBound,false);
  const single=listingMetadata({title:'6pcs/3 Pairs Of Thick Latex Kitchen Gloves, Reusable and Durable, Size M'});
  assert.match(single.fields.quantity.value,/6pcs\/3 Pairs/);assert.equal(single.fields.material.value,'Latex');assert.equal(single.fields.dimensions.value,'Size M');
});
test('brand/model read independently of reference specs, remain bound to current product fields, and shop names/IDs are never substitutes',()=>{
  const info=listingMetadata({title:'12-Pack Kitchen Gloves',text:'Brand: Acme Model: A12 Material: latex Price: $7.03 Sold: 370',listingFields:[{label:'店铺名称',value:'QITONG FANG'},{label:'商品ID',value:'601123456789001'}]});
  assert.equal(info.fields.brand.value,'Acme');assert.equal(info.fields.model.value,'A12');assert.equal(info.fields.material.value,'latex');
  const checks=localSpecChecks({},'Brand: Acme; Model: A12; Material: latex');
  assert.equal(checks.find(check=>check.key==='brand').candidateValue,'Acme');assert.equal(checks.find(check=>check.key==='model').candidateValue,'A12');assert.ok(checks.every(check=>check.status==='unknown'));
  const absent=listingMetadata({title:'Acme Kitchen Gloves 601123456789001',listingFields:[{label:'店铺名称',value:'Acme'},{label:'商品ID',value:'601123456789001'}]});
  assert.equal(absent.fields.brand.status,'not-shown');assert.equal(absent.fields.model.status,'not-shown');
});
test('visible structured/labeled values retain evidence and multi-SKU descriptions do not silently bind a variant',()=>{
  const info=listingMetadata({title:'1pc/2pcs/4pcs Silicone Bottle 12 x 8 cm',structuredSpecs:{brand:'Real Brand'},listingFields:[{label:'型号',value:'B77'},{label:'Size',value:'S/M/L'}],sourceUrl:'https://www.temu.com/goods.html?goods_id=601123456789001'});
  assert.equal(info.fields.quantity.status,'options');assert.equal(info.fields.brand.value,'Real Brand');assert.equal(info.fields.model.value,'B77');assert.equal(info.fields.dimensions.value,'S/M/L');assert.equal(info.fields.dimensions.source,'visible-field');
  assert.equal(info.fields.material.evidence[0].source,'title-literal');assert.equal(info.fields.material.evidence[0].evidence,'1pc/2pcs/4pcs Silicone Bottle 12 x 8 cm');assert.equal(info.skuBound,false);
  assert.equal(listingMetadata({title:null,listingFields:null,structuredSpecs:null}).fields.brand.status,'not-shown');
  assert.equal(listingMetadata({title:'3双乳胶厨房手套'}).fields.quantity.value,'3双');
  assert.equal(listingMetadata({title:'厨房手套 3个月保修'}).fields.quantity.status,'not-shown');
});
