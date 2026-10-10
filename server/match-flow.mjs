import {decideProductMatch,isProductMatch} from '../shared/core.mjs';
import {inferListingColorMatch} from '../shared/title-match.mjs';

// Both title groups must finish visual review before any color-only fallback.
export async function groupedProductReview({titleEvidence,review,colors,referenceSpecs={},candidateText=''}){
  let result=await review();
  const matched=isProductMatch(result);
  result={...result,titleEvidence,subjectReview:{completed:true,matched}};
  if(matched||titleEvidence.group!=='similar')return result;
  let colorEvidence;
  try{colorEvidence=await colors(result);}
  catch(error){colorEvidence={valid:false,similarity:null,reason:'主体颜色读取未完成：'+String(error.message).slice(0,120)};}
  const listingColorMatch=inferListingColorMatch(titleEvidence,colorEvidence,result.subjectReview);
  const comparison={...result,listingColorMatch};
  return {...comparison,...decideProductMatch(comparison,referenceSpecs,candidateText),evidence:[...(result.evidence||[]),listingColorMatch.reason]};
}
