import sharp from 'sharp';

export const MAX_IMAGE_BYTES=8_000_000;
const supported=new Set(['jpeg','png','webp','heif','avif','gif','tiff']);

export function sameProductImageAsset(referenceUrl,candidateUrl){
  function asset(raw){
    try{
      const url=new URL(raw);
      if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!url.hostname.endsWith('.kwcdn.com'))return null;
      // TEMU also uses immutable 32-hex goods image names (product/open),
      // as in the user's toothpaste-roller query. Treat only the exact path as
      // one image asset; never infer product identity from a similar hash.
      if(!/^\/product\/.*\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}-goods)\.(?:jpg|jpeg|png|webp|avif)$/i.test(url.pathname))return null;
      const transform=decodeURIComponent(url.search.slice(1));
      if(transform&&!/^imageView2\/2(?:\/(?:w|h|q)\/\d{1,4}|\/format\/(?:avif|webp|jpg|jpeg|png))*$/i.test(transform))return null;
      return url.origin+url.pathname;
    }catch{return null;}
  }
  const a=asset(referenceUrl),b=asset(candidateUrl);return Boolean(a&&a===b);
}

// CDN filename extensions and Content-Type labels can disagree with the actual encoded bytes.
// Decode the raster and return a lossless PNG that both local and cloud vision can consume.
export async function normalizeImage(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw new Error('商品图片内容为空');
  if(buffer.length>MAX_IMAGE_BYTES)throw new Error('商品图片超过 8 MB');
  const options={limitInputPixels:40_000_000,failOn:'error',animated:false};
  let metadata;
  try{metadata=await sharp(buffer,options).metadata();}
  catch{throw new Error('图片地址未返回可解码的商品图片，请重新选择商品主图');}
  if(!supported.has(metadata.format))throw new Error('商品图片类型无法读取（'+String(metadata.format||'未知')+'），请重新选择商品主图');
  let converted;
  try{converted=await sharp(buffer,options).rotate().toColourspace('srgb').png().toBuffer();}
  catch{throw new Error('商品图片解码失败，请重新选择另一张产品图片');}
  if(converted.length>MAX_IMAGE_BYTES){
    // Bound the base64 response size for highly compressed, large source images.
    converted=await sharp(buffer,options).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).toColourspace('srgb').png().toBuffer();
  }
  if(converted.length>MAX_IMAGE_BYTES)throw new Error('商品图片转换后超过 8 MB，请选择较小的产品图片');
  return {buffer:converted,dataUrl:'data:image/png;base64,'+converted.toString('base64'),sourceFormat:metadata.format};
}
