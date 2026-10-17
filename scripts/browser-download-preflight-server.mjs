import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Developer-only real Worker/fetch check. No account queries or production storage.
const repository=fileURLToPath(new URL('../',import.meta.url));
const extension=path.join(repository,'extension');
const fixture=new URL('../.cache/subject-validation/toothpaste-original.png',import.meta.url);
const officialImage='https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>浏览器图片下载验证</title><link rel="stylesheet" href="/check.css"><main><p>开发验证 · 不访问图搜账号</p><h1>浏览器图片下载验证</h1><p>直接使用浏览器原生Worker fetch、本地验证图片，以及此前已抓取的官方手套图片。</p><button id="native">检查原生Worker下载</button><button id="official">检查官方图片与核对</button><p id="status" role="status">尚未验证</p><img id="preview" alt="从官方地址实际下载并解码的图片" hidden><pre id="report"></pre></main><script type="module" src="/check.mjs"></script></html>`;
const script=String.raw`import {engineRequest,closeEngine} from '/engine-client.mjs';
const report=document.getElementById('report'),status=document.getElementById('status'),results={};let probe;
function show(){report.textContent=JSON.stringify(results,null,2);}
document.getElementById('native').onclick=()=>{probe?.terminate();probe=new Worker('/probe.js');status.textContent='正在用原生Worker下载本地图片…';probe.onmessage=event=>{results.native=event.data;show();status.textContent=event.data.ok?'原生下载、解码及重复请求复用通过。':'原生下载失败：'+event.data.error;probe.terminate();};probe.onerror=event=>{status.textContent='验证Worker错误：'+event.message;};};
document.getElementById('official').onclick=async()=>{status.textContent='正在通过实际识别引擎下载官方图片…';try{const {url}=await(await fetch('/official.json')).json();const image=await engineRequest('/image',{imageUrl:url});const bitmap=await createImageBitmap(await(await fetch(image.dataUrl)).blob());const width=bitmap.width,height=bitmap.height;bitmap.close();const preview=document.getElementById('preview');preview.src=image.dataUrl;preview.hidden=false;const phases={};for(const phase of ['image-priority','page-image','subject-review']){const result=await engineRequest('/compare',{phase,referenceImage:image.dataUrl,referenceImageUrl:url,imageUrl:url,referenceTitle:'',candidateTitle:'',referenceSpecs:{}});phases[phase]={samePhoto:result.comparison.samePhoto,status:result.comparison.status||'priority'};}results.official={ok:true,url,width,height,phases};show();status.textContent='官方图片下载、解码及三个核对阶段通过。';}catch(error){results.official={ok:false,error:error.message};show();status.textContent='官方图片验证失败：'+error.message;}};
window.addEventListener('pagehide',()=>{probe?.terminate();closeEngine();});`;
const probe=String.raw`import {ImageLoader} from './browser/image-loader.mjs';import sharp from './browser/sharp.mjs';
const url=new URL('/fixture.png',self.location.href).href;
const loader=new ImageLoader({allowed:value=>value===url,decode:input=>sharp(input).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).png().toBuffer()});
Promise.all([loader.get(url),loader.get(url)]).then(async([a,b])=>{const image=await createImageBitmap(new Blob([a.buffer]));postMessage({ok:true,nativeFetch:true,sharedDownload:a===b,width:image.width,height:image.height,bytes:a.buffer.length});image.close();}).catch(error=>postMessage({ok:false,error:error.message}));`;

http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' data: https://img.kwcdn.com; img-src 'self' data:; worker-src 'self'; object-src 'none'");
  const name=new URL(req.url,'http://localhost').pathname;
  try{
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(name==='/check.mjs'){res.setHeader('Content-Type','text/javascript');res.end(script);return;}
    if(name==='/check.css'){res.setHeader('Content-Type','text/css');res.end('body{font:16px/1.7 system-ui;background:#eef5f0;color:#193c2d;padding:24px}main{max-width:900px;margin:auto;background:white;border-radius:18px;padding:26px}button{font:inherit;padding:10px 16px;background:#126446;color:white;border:0;border-radius:8px;margin-right:8px}#status{padding:14px;background:#edf5ee;border-radius:8px}pre{white-space:pre-wrap;font-size:13px}img{max-width:180px;max-height:180px;object-fit:contain}');return;}
    if(name==='/official.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:officialImage}));return;}
    if(name==='/fixture.png'){res.setHeader('Content-Type','image/png');res.end(await readFile(fixture));return;}
    if(name==='/probe.js'){
      const result=await build({stdin:{contents:probe,resolveDir:repository},bundle:true,write:false,platform:'browser',format:'iife',target:'chrome116',inject:[path.join(repository,'browser/polyfills.mjs')]});
      res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].contents);return;
    }
    const location=path.resolve(extension,'.'+name);
    if(!location.startsWith(extension+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript':name.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(await readFile(location));
  }catch(error){res.writeHead(500);res.end(String(error.message));}
}).listen(43213,'127.0.0.1',()=>console.log('Worker download check: http://127.0.0.1:43213/'));
