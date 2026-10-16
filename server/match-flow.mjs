import {decideProductMatch,isProductMatch} from '../shared/core.mjs';
import {inferListingColorMatch} from '../shared/title-match.mjs';

// Both title groups must finish visual review before any color-only fallback.
export async function groupedProductReview({titleEvidence,review,colors,outlines,referenceSpecs={},candidateText=''}){
  let result=await review();
  const matched=isProductMatch(result);
  result={...result,titleEvidence,subjectReview:{completed:true,matched}};
  if(matched)return result;
  if(titleEvidence.group==='similar'){
    let colorEvidence;
    try{colorEvidence=await colors(result);}
    catch(error){colorEvidence={valid:false,similarity:null,reason:'主体颜色读取未完成：'+String(error.message).slice(0,120)};}
    const listingColorMatch=inferListingColorMatch(titleEvidence,colorEvidence,result.subjectReview);
    const comparison={...result,listingColorMatch};
    result={...comparison,...decideProductMatch(comparison,referenceSpecs,candidateText),evidence:[...(result.evidence||[]),listingColorMatch.reason]};
  }
  if(!outlines||isProductMatch(result)||result.status!=='pending'||decideProductMatch(result,referenceSpecs,candidateText).status==='different')return result;
  let evidence;
  try{evidence=await outlines(result);}
  catch(error){evidence={revision:'subject-outline-v1',valid:false,matched:false,reason:'主体轮廓读取未完成：'+String(error.message).slice(0,120)};}
  const outlineMatch={...evidence,priorStatus:'pending',subjectReview:result.subjectReview};
  const comparison={...result,outlineMatch};
  return {...comparison,...decideProductMatch(comparison,referenceSpecs,candidateText),evidence:[...(result.evidence||[]),outlineMatch.reason]};
}
