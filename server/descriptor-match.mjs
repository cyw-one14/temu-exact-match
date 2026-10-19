// Compute each symmetric cosine once. Preserve the original summation order,
// strict tie handling and thresholds; only reusable arithmetic is removed.
export function nearestPatches(left,right){
  const squaredNorm=vector=>{let total=0;for(let i=0;i<vector.length;i++)total+=vector[i]*vector[i];return total;};
  const leftNorms=left.map(squaredNorm),rightNorms=right.map(squaredNorm);
  const ab=left.map(()=>({index:-1,score:-1})),ba=right.map(()=>({index:-1,score:-1}));
  for(let i=0;i<left.length;i++)for(let j=0;j<right.length;j++){
    const a=left[i],b=right[j];let score=0;
    if(a.length&&a.length===b.length&&leftNorms[i]&&rightNorms[j]){
      let dot=0;for(let k=0;k<a.length;k++)dot+=a[k]*b[k];
      score=Math.max(-1,Math.min(1,dot/Math.sqrt(leftNorms[i]*rightNorms[j])));
    }
    if(score>ab[i].score)ab[i]={index:j,score};
    if(score>ba[j].score)ba[j]={index:i,score};
  }
  return {ab,ba};
}
