import test from 'node:test';
import assert from 'node:assert/strict';
import {titleMatchEvidence,inferListingColorMatch} from '../shared/title-match.mjs';
import {foregroundColorEvidence} from '../server/subjects.mjs';
import {decideProductMatch,rankMatches,bestSellerKeywords,parseSales} from '../shared/core.mjs';

test('title shortlist ignores pack/layout and marketing colors while retaining actual product descriptions',()=>{
  const reference='3 pairs thick latex kitchen gloves beige mint green';
  const same=titleMatchEvidence(reference,'22pcs (11Pairs) Random Color Thick Latex Kitchen Gloves');
  assert.equal(same.highSimilarity,true);assert.equal(same.reviewEligible,true);
  assert.ok(same.sharedTerms.includes('glove'));assert.ok(!same.sharedTerms.includes('pairs'));
  const other=titleMatchEvidence(reference,'Green kitchen water bottle reusable');
  assert.equal(other.categoryConflict,true);assert.equal(other.reviewEligible,false);assert.equal(other.inferenceEligible,false);
  assert.equal(titleMatchEvidence('', 'Kitchen gloves').reviewEligible,true,'missing reference title keeps original image workflow');
  assert.equal(titleMatchEvidence('Kitchen Gloves', 'Kitchen Gloves').inferenceEligible,false,'generic short category alone is insufficient');
  const longTitle='3 pairs thick kitchen gloves beige mint green for dishwashing cleaning household chores ergonomic durable';
  assert.equal(titleMatchEvidence(longTitle,'22pcs Thick Latex Kitchen Gloves').highSimilarity,true,'a longer marketing title can share the main product description');
});

test('brand requires an explicitly available value, shared type and actual title terms; never brand alone',()=>{
  assert.equal(titleMatchEvidence('latex kitchen glove','cotton kitchen glove','Acme','acme').inferenceEligible,true);
  assert.equal(titleMatchEvidence('latex kitchen glove','plastic water bottle','Acme','Acme').inferenceEligible,false);
  assert.equal(titleMatchEvidence('latex kitchen glove','cotton kitchen glove','Unknown','Unknown').sameBrand,false);
  assert.equal(titleMatchEvidence('latex kitchen glove','cotton kitchen glove','','').inferenceEligible,false);
});

test('coarse palette fallback remains inferred and cannot supply verified seller keywords or override visible differences',()=>{
  const title=titleMatchEvidence('Thick latex kitchen gloves 3 pairs','Thick latex kitchen gloves 11 pairs');
  const color={valid:true,similarity:.875};
  const inferred=inferListingColorMatch(title,color);assert.equal(inferred.matched,true);
  assert.equal(inferListingColorMatch(title,{valid:true,similarity:.5}).matched,false);
  assert.equal(inferListingColorMatch(title,{valid:false,similarity:1}).matched,false);
  assert.equal(inferListingColorMatch(title,{valid:true,similarity:Infinity}).matched,false);
  const comparison={visual:'uncertain',listingColorMatch:inferred,checks:[]};
  const decision=decideProductMatch(comparison,{quantity:'3 pairs'},'Quantity: 11 pairs');
  assert.equal(decision.status,'inferred-match');assert.ok(decision.packDifference);
  const item={...decision,id:'inferred',title:'Thick latex kitchen gloves',sales:parseSales('2000 sold'),market:'us'};
  assert.equal(rankMatches([item]).length,1);assert.deepEqual(bestSellerKeywords([item]),[]);
  assert.equal(decideProductMatch({...comparison,visual:'different',differences:['The palm design differs']}).status,'different');
  assert.equal(decideProductMatch({...comparison,subject:{matched:true}}).status,'visual-match');
});

test('foreground color evidence is separate from identity and unavailable masks cannot infer a match',()=>{
  const colors=Array(64).fill(0);colors[12]=1;
  assert.equal(foregroundColorEvidence({valid:true,colors},{valid:true,colors}).similarity,1);
  assert.equal(foregroundColorEvidence({valid:false,colors},{valid:true,colors}).valid,false);
});
