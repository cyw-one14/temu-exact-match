// Shared immutable CDN asset identity; never derives product identity from a hash.
export function sameProductImageAsset(referenceUrl,candidateUrl){
  function asset(raw){try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!url.hostname.endsWith('.kwcdn.com'))return null;
    if(!/^\/product\/.*\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}-goods)\.(?:jpg|jpeg|png|webp|avif)$/i.test(url.pathname))return null;
    const transform=decodeURIComponent(url.search.slice(1));
    if(transform&&!/^imageView2\/2(?:\/(?:w|h|q)\/\d{1,4}|\/format\/(?:avif|webp|jpg|jpeg|png))*$/i.test(transform))return null;
    return url.origin+url.pathname;
  }catch{return null;}}
  const a=asset(referenceUrl),b=asset(candidateUrl);return Boolean(a&&a===b);
}
