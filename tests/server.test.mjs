import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {subjectState} from '../server/subjects.mjs';
process.env.TEMU_MATCH_PORT='43201';
const {server,extensionId,allowedImageUrl}=await import('../server/index.mjs');
await new Promise(resolve=>server.listen(43201,'127.0.0.1',resolve));
test.after(()=>{server.closeAllConnections();server.close();});
const base='http://127.0.0.1:43201';
const origin='chrome-extension://'+extensionId;

test('local service rejects requests from arbitrary web pages',async()=>{
  const response=await fetch(base+'/config',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json','X-Temu-Client':'exact-match'},body:'{}'});
  assert.equal(response.status,403);
});
test('only the paired extension origin receives CORS access',async()=>{
  const response=await fetch(base+'/profile',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-temu-client'}});
  assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);
});
test('image fetches are constrained to HTTPS TEMU-owned domains',()=>{
  assert.equal(allowedImageUrl('https://img.kwcdn.com/product.jpg').hostname,'img.kwcdn.com');
  assert.throws(()=>allowedImageUrl('http://127.0.0.1/admin'));
  assert.throws(()=>allowedImageUrl('https://kwcdn.com.attacker.example/product.jpg'));
  assert.throws(()=>allowedImageUrl('https://user:password@img.kwcdn.com/product.jpg'));
});
test('the selected-image endpoint cannot download arbitrary URLs',async()=>{
  const response=await fetch(base+'/image',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Temu-Client':'exact-match'},body:JSON.stringify({imageUrl:'http://127.0.0.1/admin'})});assert.equal(response.status,400);assert.match((await response.json()).error,/官方商品图片/);
});
test('invalid images do not invoke inference',async()=>{
  const response=await fetch(base+'/profile',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Temu-Client':'exact-match'},body:JSON.stringify({referenceImage:'data:text/html;base64,WA=='})});
  assert.equal(response.status,400);assert.equal((await response.json()).ok,false);
});
test('provider configuration never returns saved API key values',async()=>{
  const response=await fetch(base+'/config',{headers:{Origin:origin,'X-Temu-Client':'exact-match'}});
  assert.equal(response.status,200);const config=await response.json();assert.equal(Object.hasOwn(config,'apiKey'),false);
});
test('the local setup page can read non-secret configuration using browser same-origin metadata',async()=>{
  const response=await fetch(base+'/config',{headers:{'Sec-Fetch-Site':'same-origin','X-Temu-Client':'exact-match'}});
  assert.equal(response.status,200);assert.equal((await response.json()).engine,'local');
});

test('HTTP page matching and image priority never invoke subject inference, including the default phase',async()=>{
  const pixels=Buffer.alloc(64*64*3);
  for(let i=0;i<pixels.length;i++)pixels[i]=(i*37)%256;
  const buffer=await sharp(pixels,{raw:{width:64,height:64,channels:3}}).png().toBuffer();
  const originalFetch=globalThis.fetch,modelBefore=JSON.stringify(subjectState),imageRequests=[];
  globalThis.fetch=(url,options)=>{if(String(url).startsWith('https://img.kwcdn.com/')){imageRequests.push(String(url));return Promise.resolve(new Response(buffer,{headers:{'Content-Type':'image/png'}}));}return originalFetch(url,options);};
  try{
    for(const phase of [undefined,'image-priority','page-match']){
      const response=await fetch(base+'/compare',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Temu-Client':'exact-match'},body:JSON.stringify({phase,referenceImage:'data:image/png;base64,'+buffer.toString('base64'),imageUrl:'https://img.kwcdn.com/page-matching-fixture.jpg',referenceImages:['https://img.kwcdn.com/not-needed-gallery.jpg'],referenceImageSource:'public-jsonld'})});
      const data=await response.json();assert.equal(response.status,200,data.error);
      assert.equal(data.comparison.subject,null);assert.equal(data.comparison.matchStage,'page-image');
      assert.equal(data.comparison.samePhoto,true);
      if(phase==='image-priority')assert.equal(data.comparison.priorityScore,1);
      else assert.equal(data.comparison.status,'visual-match');
    }
    assert.equal(JSON.stringify(subjectState),modelBefore);
    assert.equal(imageRequests.some(url=>url.includes('not-needed-gallery')),false,'gallery is never fetched by initial page matching');
  }finally{globalThis.fetch=originalFetch;}
});
