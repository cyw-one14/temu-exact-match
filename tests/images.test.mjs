import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeImage,sameProductImageAsset} from '../server/images.mjs';
import {imageBuffer,comparePixels,localCompare,pageCompare} from '../server/vision.mjs';

const pixels=Buffer.from(Array.from({length:64*48*3},(_,i)=>(i*17+Math.floor(i/192)*11)%256));
const source=()=>sharp(pixels,{raw:{width:64,height:48,channels:3}});

test('AVIF, JPEG, PNG, WebP and GIF inputs become valid PNG vision inputs',async()=>{
  for(const format of ['avif','jpeg','png','webp','gif']){
    const encoded=await source().toFormat(format).toBuffer();
    const result=await normalizeImage(encoded);
    assert.match(result.dataUrl,/^data:image\/png;base64,/);
    const metadata=await sharp(imageBuffer(result.dataUrl)).metadata();
    assert.equal(metadata.format,'png');assert.equal(metadata.width,64);assert.equal(metadata.height,48);
    if(format==='avif')assert.ok(['heif','avif'].includes(result.sourceFormat));
    assert.equal((await comparePixels(encoded,result.buffer)).samePhoto,true);
  }
});
test('HTML error pages, SVG, corrupt files and oversized payloads cannot be treated as product photos',async()=>{
  await assert.rejects(normalizeImage(Buffer.from('<html>Login required</html>')),/可解码/);
  await assert.rejects(normalizeImage(Buffer.from('<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')),/类型无法读取/);
  await assert.rejects(normalizeImage(Buffer.alloc(0)),/内容为空/);
  await assert.rejects(normalizeImage(Buffer.alloc(8_000_001)),/超过 8 MB/);
});

test('same-image URL evidence accepts size and codec transforms but rejects different photos, crops and arbitrary hosts',()=>{
  const image='https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg';
  assert.equal(sameProductImageAsset(image+'?imageView2/2/w/800/q/70/format/avif',image+'?imageView2/2/w/200/q/70/format/webp'),true);
  assert.equal(sameProductImageAsset(image,image.replace('3a9883af','4a9883af')),false);
  assert.equal(sameProductImageAsset(image,image+'?imageMogr2/crop/100x100'),false);
  assert.equal(sameProductImageAsset(image,image.replace('img.kwcdn.com','evil.example')),false);
  assert.equal(sameProductImageAsset(undefined,image),false);
  const goods='https://img.kwcdn.com/product/open/44ccfb56032749bcaa0bc9830cace2c8-goods.jpeg';
  assert.equal(sameProductImageAsset(goods+'?imageView2/2/w/800/q/70/format/avif',goods+'?imageView2/2/w/200/q/70/format/jpg'),true);
  assert.equal(sameProductImageAsset(goods,goods.replace('44ccfb','54ccfb')),false);
  assert.equal(sameProductImageAsset(goods,goods+'?imageMogr2/crop/100x100'),false);
});

test('near-identical pixels require same-asset proof and complete spec evidence before exact recommendation',async()=>{
  const gradient=Buffer.from(Array.from({length:64*48*3},(_,i)=>Math.floor(i/3)%64*3));
  const a=await sharp(gradient,{raw:{width:64,height:48,channels:3}}).png().toBuffer();
  const b=await sharp(a).jpeg({quality:75}).toBuffer();
  assert.equal((await comparePixels(a,b)).samePhoto,false);
  assert.equal((await comparePixels(a,b,{sameAsset:true})).samePhoto,true);
  assert.equal((await localCompare(a,b,{},'',{sameAsset:true})).status,'pending');
  const known={brand:'Acme',model:'A12',material:'silicone',dimensions:'500ml',quantity:'1pc'};
  const evidence='Brand: Acme; Model: A12; Material: silicone; Capacity: 500ml; Quantity: 1pc';
  assert.equal((await localCompare(a,b,known,evidence,{sameAsset:true})).status,'exact');
  assert.equal((await localCompare(a,b,known,evidence.replace('500ml','750ml'),{sameAsset:true})).status,'pending');
});

test('reencoded complete photos match without URL equality while local product edits, smooth backgrounds and crops stay unconfirmed',async()=>{
  const width=512,height=512,scene=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*3,texture=8*Math.sin(x*.7)+6*Math.cos(y*.63);
    const color=x<256?[174,132,211]:[103,186,208];
    for(let c=0;c<3;c++)scene[i+c]=Math.round(color[c]+texture+(x+y)%3);
  }
  const original=await sharp(scene,{raw:{width,height,channels:3}}).png().toBuffer();
  const copy=await sharp(original).resize(400,400).webp({quality:85}).toBuffer();
  const photo=await comparePixels(original,copy);assert.equal(photo.assetVerified,false);assert.equal(photo.reencodedPhoto,true);assert.equal(photo.samePhoto,true);
  const comparison=await pageCompare(original,copy,{},'Brand: Different Brand; Quantity: 11 pairs');
  assert.equal(comparison.status,'visual-match');assert.equal(comparison.subject,null);assert.match(comparison.evidence.join(' '),/压缩/);
  const changed=Buffer.from(scene);
  for(let y=150;y<166;y++)for(let x=150;x<166;x++){const i=(y*width+x)*3;changed[i]=255;changed[i+1]=255;changed[i+2]=255;}
  const altered=await sharp(changed,{raw:{width,height,channels:3}}).png().toBuffer();
  const negative=await comparePixels(original,altered);assert.ok(negative.imageSimilarity>=.985,'shared whole-image score alone would look very close');assert.equal(negative.samePhoto,false);assert.ok(negative.photoEncoding.worstTileError>6);
  const cropped=await sharp(original).extract({left:32,top:32,width:448,height:448}).png().toBuffer();assert.equal((await comparePixels(original,cropped)).samePhoto,false);
  const blank=await sharp({create:{width,height,channels:3,background:'#eee'}}).png().toBuffer();assert.equal((await comparePixels(blank,await sharp(blank).webp().toBuffer())).samePhoto,false);
});
