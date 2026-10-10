import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDescriptors,cosine} from '../server/subjects.mjs';
import {decideProductMatch,rankMatches,bestSellerKeywords,titleQuantity} from '../shared/core.mjs';
const descriptor={valid:true,embedding:[1,0,0],patches:[[1,0,0],[0,1,0],[0,0,1]],colors:[1,0]};

test('matching shape features do not override a different subject color or an invalid foreground mask',()=>{
  assert.equal(compareDescriptors(descriptor,descriptor).matched,true);
  assert.equal(compareDescriptors(descriptor,{...descriptor,colors:[0,1]}).matched,false);
  assert.equal(compareDescriptors(descriptor,{...descriptor,embedding:[0,1,0]}).matched,false);
  assert.equal(compareDescriptors(descriptor,{...descriptor,valid:false}).valid,false);
  assert.equal(cosine([0,0],[0,0]),0);
});

test('confirmed appearance matches expose title and price despite missing hidden specs, while explicit differences are excluded',()=>{
  const visual={visual:'uncertain',subject:{matched:true},checks:[],differences:[]};
  assert.equal(decideProductMatch(visual,{},'').status,'visual-match');
  assert.equal(decideProductMatch({...visual,subject:{matched:false}}, {},'').status,'pending');
  assert.equal(decideProductMatch(visual,{quantity:'3 pairs'},'Quantity: 1 pair').status,'visual-match');
  assert.equal(decideProductMatch(visual,{dimensions:'500ml'},'Capacity: 0.5 L').status,'visual-match');
  assert.equal(decideProductMatch({...visual,visualChecks:[{key:'construction',status:'different',evidence:'different cuff shape'}]},{},'').status,'different');
  const match={id:'visual',status:'visual-match',title:'Original seller glove title',priceText:'$5.99',url:'https://www.temu.com/goods.html?goods_id=601123456789001',sales:{lowerBound:100,period:'unknown'}};
  assert.equal(rankMatches([match,{...match,id:'wrong',status:'different',sales:{lowerBound:9000}}]).length,1);
  assert.equal(bestSellerKeywords([match])[0].keywords[0].sources[0].matchStatus,'visual-match');
});

test('literal title quantities label different packs without guessing a multi-SKU choice or prematurely excluding products',()=>{
  assert.equal(titleQuantity('4pcs Rotating Vertical Toothpaste Squeezer Roller'),'4pcs');
  assert.equal(titleQuantity('9-Unit Rolling Tube of Toothpaste'),'9-Unit');
  assert.equal(titleQuantity('12 Pack Toothpaste Squeezer Roller'),'12 Pack');
  assert.equal(titleQuantity('1pc/2pcs/4pcs/20pcs Toothpaste Squeezer'),'');
  assert.equal(titleQuantity('4pcs pack of 4 pieces'),'4pcs');
  assert.equal(titleQuantity('1.4pcs'), '');
  const visual={visual:'uncertain',checks:[],differences:[]};
  assert.equal(decideProductMatch(visual,{quantity:'4pcs'},'Quantity: 9-Unit').status,'pending');
  assert.equal(decideProductMatch(visual,{quantity:'4pcs'},'Quantity: 12 Pack').status,'pending');
  assert.equal(decideProductMatch({...visual,visual:'same_photo'},{quantity:'4pcs'},'Quantity: 4 Pack').status,'visual-match');
});
