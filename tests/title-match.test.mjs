import test from 'node:test';
import assert from 'node:assert/strict';
import {titleMatchEvidence,inferListingColorMatch} from '../shared/title-match.mjs';
import {foregroundColorEvidence} from '../server/subjects.mjs';
import {groupedProductReview} from '../server/match-flow.mjs';
import {decideProductMatch,rankMatches,bestSellerKeywords,parseSales} from '../shared/core.mjs';
const similar=()=>titleMatchEvidence('3 pairs thick latex kitchen gloves','22pcs thick latex kitchen gloves');
const different=()=>titleMatchEvidence('Thick latex kitchen gloves','Green water bottle');
const completed={completed:true,matched:false};

test('title groups ignore pack/color marketing but both groups and missing titles remain eligible for subject review',()=>{
  const same=similar();assert.equal(same.group,'similar');assert.equal(same.reviewEligible,true);
  assert.ok(same.sharedTerms.includes('glove'));assert.ok(!same.sharedTerms.includes('pairs'));
  const other=different();assert.equal(other.categoryConflict,true);assert.equal(other.group,'dissimilar');assert.equal(other.reviewEligible,true);assert.equal(other.inferenceEligible,false);
  assert.equal(titleMatchEvidence('', 'Kitchen gloves').group,'unknown');assert.equal(titleMatchEvidence('', 'Kitchen gloves').reviewEligible,true);
  assert.equal(titleMatchEvidence('Kitchen Gloves','Kitchen Gloves').similar,true);
  const longTitle='3 pairs thick kitchen gloves beige mint green for dishwashing cleaning household chores ergonomic durable';
  assert.equal(titleMatchEvidence(longTitle,'22pcs Thick Latex Kitchen Gloves').similar,true);
});

test('same brand is annotation only and cannot move dissimilar titles to the color branch',()=>{
  const title=titleMatchEvidence('Red glove','Heavy cotton glove','Acme','Acme');
  assert.equal(title.sameBrand,true);assert.equal(title.similar,false);assert.equal(title.inferenceEligible,false);
  assert.equal(inferListingColorMatch(title,{valid:true,similarity:1},completed).matched,false);
});

test('title/color rule requires completed unsuccessful subject review and supports ranking/keywords with its own evidence',()=>{
  const title=similar(),color={valid:true,similarity:.875};
  assert.equal(inferListingColorMatch(title,color).matched,false);assert.equal(inferListingColorMatch(title,color,{completed:true,matched:true}).matched,false);
  const fallback=inferListingColorMatch(title,color,completed);assert.equal(fallback.matched,true);
  for(const value of [{valid:true,similarity:.5},{valid:false,similarity:1},{valid:true,similarity:Infinity}])assert.equal(inferListingColorMatch(title,value,completed).matched,false);
  const comparison={visual:'uncertain',listingColorMatch:fallback,checks:[]};
  const decision=decideProductMatch(comparison,{quantity:'3 pairs'},'Quantity: 11 pairs');assert.equal(decision.status,'rule-match');assert.ok(decision.packDifference);
  const item={...decision,id:'rule',title:'Thick latex kitchen gloves',sales:parseSales('2000 sold'),market:'us'};
  assert.equal(rankMatches([item]).length,1);assert.equal(bestSellerKeywords([item])[0].keywords[0].sources[0].matchStatus,'rule-match');
  assert.deepEqual(bestSellerKeywords([{...item,status:'inferred-match'}]),[]);assert.equal(decideProductMatch({...comparison,subject:{matched:true}}).status,'visual-match');
});

test('both title groups accept matching subjects without invoking color fallback',async()=>{
  for(const titleEvidence of [similar(),different(),titleMatchEvidence('','')]){
    const events=[];const result=await groupedProductReview({titleEvidence,review:async()=>{events.push('subject');return {status:'visual-match',visual:'identical'};},colors:async()=>{events.push('color');throw Error('must not run');}});
    assert.equal(result.status,'visual-match');assert.deepEqual(events,['subject']);assert.equal(result.subjectReview.matched,true);
  }
});

test('similar title subjects are reviewed first; color can accept a failed shape comparison and preserves its record',async()=>{
  const events=[];const result=await groupedProductReview({titleEvidence:similar(),review:async()=>{events.push('subject');return {status:'different',visual:'different',visualChecks:[{key:'shape',status:'different',evidence:'Palm construction differs'}]};},colors:async()=>{events.push('color');return {valid:true,similarity:.9};}});
  assert.deepEqual(events,['subject','color']);assert.equal(result.status,'rule-match');assert.deepEqual(result.subjectDifferences,['Palm construction differs']);
});

test('dissimilar title subjects cannot be rescued by color, even with identical brands',async()=>{
  const titleEvidence=titleMatchEvidence('Kitchen gloves','Plastic water bottle','Acme','Acme');let colors=0;
  const result=await groupedProductReview({titleEvidence,review:async()=>({status:'pending',visual:'uncertain'}),colors:async()=>{colors++;return {valid:true,similarity:1};}});
  assert.equal(result.status,'pending');assert.equal(colors,0);
});

test('failed review does not run color; missing color does not create a match',async()=>{
  let colors=0;await assert.rejects(groupedProductReview({titleEvidence:similar(),review:async()=>{throw Error('review failed');},colors:async()=>{colors++;return {valid:true,similarity:1};}}),/review failed/);assert.equal(colors,0);
  const result=await groupedProductReview({titleEvidence:similar(),review:async()=>({status:'pending',visual:'uncertain'}),colors:async()=>{throw Error('unavailable');}});
  assert.equal(result.status,'pending');assert.equal(result.listingColorMatch.colorEvidence.valid,false);
});

test('foreground color evidence is separate from identity; unavailable masks cannot match',()=>{
  const colors=Array(64).fill(0);colors[12]=1;
  assert.equal(foregroundColorEvidence({valid:true,colors},{valid:true,colors}).similarity,1);assert.equal(foregroundColorEvidence({valid:false,colors},{valid:true,colors}).valid,false);
});

const outline=()=>({revision:'subject-outline-v1',valid:true,matched:true,iou:.95,boundaryCoverage:.96,similarity:.95,reason:'TEST captured silhouette match'});
test('every title group can use outlines only after unsuccessful subject review and any eligible color fallback',async()=>{
  for(const titleEvidence of [similar(),different(),titleMatchEvidence('','')]){
    const events=[];const result=await groupedProductReview({titleEvidence,review:async()=>{events.push('subject');return {status:'pending',visual:'uncertain'};},colors:async()=>{events.push('color');return {valid:true,similarity:.4};},outlines:async()=>{events.push('outline');return outline();}});
    assert.deepEqual(events,titleEvidence.group==='similar'?['subject','color','outline']:['subject','outline']);assert.equal(result.status,'outline-match');assert.equal(result.outlineMatch.subjectReview.completed,true);assert.equal(result.outlineMatch.priorStatus,'pending');
    const item={...result,id:'shape',title:'Original captured glove phrase',url:'https://www.temu.com/goods.html?goods_id=601123456789001',sales:parseSales('200 sold'),market:'us'};
    assert.equal(rankMatches([item]).length,1);assert.equal(bestSellerKeywords([item])[0].products[0].keywordEvidence[0].matchStatus,'outline-match');
  }
});
test('outline fallback does not replace confirmed matches, a passing color rule, explicit image differences or a failed review',async()=>{
  let calls=0;const outlines=async()=>{calls++;return outline();};
  for(const review of [async()=>({status:'visual-match',subject:{matched:true}}),async()=>({status:'different',visual:'different'}),async()=>({status:'pending',visual:'different'}),async()=>({status:'pending',visualChecks:[{key:'construction',status:'different',evidence:'clear product structure difference'}]})])await groupedProductReview({titleEvidence:different(),review,outlines});
  const color=await groupedProductReview({titleEvidence:similar(),review:async()=>({status:'pending'}),colors:async()=>({valid:true,similarity:.99}),outlines});assert.equal(color.status,'rule-match');
  await assert.rejects(groupedProductReview({titleEvidence:different(),review:async()=>{throw Error('no completed review');},outlines}));assert.equal(calls,0);
});
test('invalid or low outline metrics retain pending; shape failures stay explainable and cannot bypass explicit differences',async()=>{
  for(const value of [{...outline(),valid:false},{...outline(),iou:.89},{...outline(),boundaryCoverage:.5},{...outline(),iou:Infinity}]){
    const result=await groupedProductReview({titleEvidence:different(),review:async()=>({status:'pending',visual:'uncertain'}),outlines:async()=>value});assert.equal(result.status,'pending');
  }
  const failed=await groupedProductReview({titleEvidence:different(),review:async()=>({status:'pending'}),outlines:async()=>{throw Error('mask unavailable');}});assert.equal(failed.status,'pending');assert.equal(failed.outlineMatch.valid,false);
  const evidence={...outline(),priorStatus:'pending',subjectReview:completed};
  assert.equal(decideProductMatch({outlineMatch:evidence}).status,'outline-match');
  assert.equal(decideProductMatch({outlineMatch:{...evidence,subjectReview:{completed:false}}}).status,'pending');
  assert.equal(decideProductMatch({outlineMatch:evidence,visual:'different'}).status,'different');
  assert.equal(decideProductMatch({outlineMatch:evidence,visualChecks:[{key:'shape',status:'different',evidence:'clearly different silhouette'}]}).status,'different');
});
