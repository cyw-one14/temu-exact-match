// Isolated UI fixture; no extension is installed and no real lookup is sent.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('../extension/',import.meta.url);
const hero=process.argv.includes('--hero');
let html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>查同款按钮回归 · 测试页</title><style>body{font:16px Arial,sans-serif;margin:24px;color:#242629}h1{font-size:24px}p{max-width:700px;line-height:1.5}label{display:block;margin:20px 0}select{font:inherit;padding:8px}article{width:330px}img{display:block;width:330px;height:380px;object-fit:contain;background:#f3f3f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:700px;font-size:13px}.hint{color:#666}</style></head><body>
<h1>查同款按钮回归 · 测试数据</h1><p class="hint">本页只验证点击反馈，不向真实图搜发送数据，不代表真实扩展端到端成功。图片复用已捕获商品资源；标题与商品ID为测试字段。</p>
<label>模拟浏览器消息响应 <select id="simulation"><option value="ok">正常响应</option><option value="invalid">旧页面连接失效（同步异常）</option><option value="fallback">助手标签页响应</option><option value="timeout">无响应</option></select></label>
<article><a href="https://www.temu.com/goods.html?goods_id=601123456789001" title="界面测试：清洁手套（非真实商品字段）"><img src="https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg" alt="界面测试：清洁手套（非真实商品字段）"></a></article>
<p id="result" role="status">等待点击图片右上角的“查同款”。</p>
<script>// Test-only open shadow root for DOM-driven UI checks; production keeps closed.
const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
globalThis.chrome={storage:{local:{get:async()=>({preferences:{imageButtons:true}})},onChanged:{addListener:()=>{}}},runtime:{sendMessage:message=>{document.getElementById('result').textContent='测试消息已捕获：'+message.selection.imageUrl+' · 测试商品ID '+message.selection.productId;const mode=document.getElementById('simulation').value;if(mode==='invalid')throw Error('Extension context invalidated.');if(mode==='timeout')return new Promise(()=>{});return Promise.resolve({ok:true,opened:mode==='fallback'?'tab':'side-panel'});}}};</script>
<script src="/structured-fields.js"></script><script src="/image-buttons.js"></script></body></html>`;
if(hero)html=html.replace(/<article>[\s\S]*?<\/article>/,'<style>main{display:flex;gap:12px;width:720px}.thumbs{width:60px}.thumbs img{width:60px;height:60px}.hero img{width:600px;height:600px;object-fit:contain}.preload{position:absolute;top:1800px;width:1200px;height:1200px}</style><main><aside class="thumbs"><img src="https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg" alt="测试缩略图"></aside><div class="hero"><a href="https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg"><img id="qa-hero" src="https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg" alt="测试主图"></a></div><img class="preload" src="https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg" alt="测试屏外预加载图"></main>');
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1:43212').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!['/image-buttons.js','/structured-fields.js'].includes(path)){res.writeHead(404);res.end();return;}
  let source=await readFile(new URL(path.slice(1),root),'utf8');
  // Only this isolated fixture simulates the detail URL. Production is unchanged.
  if(hero&&path==='/image-buttons.js')source=source.replace('(() => {','(() => { const location=new URL("https://www.temu.com/goods.html?goods_id=601123456789001");');
  res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(source);
});
server.listen(43212,'127.0.0.1',()=>console.log('Image button fixture: http://127.0.0.1:43212/'));
