// Local UI fixture only. This server is separate from the production service and
// never supplies data to the installed extension or to a TEMU query.
import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
const root=new URL('../extension/',import.meta.url),files=new Set(await readdir(root));
const image='data:image/png;base64,'+(await readFile(new URL(process.argv.includes('--image-input')?'../.cache/ui-validation/reported-reference.png':'../.cache/subject-validation/glove-subject.png',import.meta.url))).toString('base64');
const fixture={matchingPolicy:'title-groups-outline-v16',matchRevision:1,keywordPolicy:'best-sellers-v1',referenceImage:image,referenceSpecs:{},referenceContext:{message:'本地界面校验：标题和价格为测试数据，非 TEMU 查询结果。'},profile:{name:'界面测试参考图'},keywords:[],selectedQueries:[],items:[{id:'qa-fixture',title:'测试标题：绿色清洁手套，防滑掌纹与加长袖口，用于验证完整商品标题显示和复制（仅界面测试数据）',imageUrl:image,priceText:'USD 5.99',price:{raw:'USD 5.99',kind:'displayed',currency:'USD',low:5.99,source:'qa-fixture',sourceUrl:'http://127.0.0.1:43211/',capturedAt:new Date().toISOString()},sales:{kind:'unknown',period:'unknown',lowerBound:null},status:'visual-match',matchSource:'automated',autoAttempt:1,market:'us',capturedAt:new Date().toISOString(),url:'http://127.0.0.1:43211/',evidence:['仅校验界面，非真实商品判断'],missing:['测试数据未提供规格']}],pages:[],lastRun:new Date().toISOString()};
if(process.argv.includes('--image-input')){
  fixture.items=[];fixture.lastRun=null;
  fixture.providerJob={manualUpload:true,submittedInput:{imageUrl:'https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg',title:'界面测试原标题：3 pairs Thick Latex Kitchen Gloves（非真实商品字段）',titleSource:'captured-product',productId:'601123456789001'}};
}
if(process.argv.includes('--top10')){
  const template=fixture.items[0];
  fixture.items=Array.from({length:13},(_,i)=>({...template,id:'qa-fixture-'+i,title:'界面测试商品 '+(i+1)+'，保留原始标题和词来源（非真实商品数据）',sales:i===12?template.sales:{raw:i===1?'99+ sold':i===2?'0.098K sold':(100-i)+' sold',kind:i===1?'lower-bound':i===2?'approximate':'exact',displayValue:100-i,lowerBound:i===2?null:100-i,exact:i!==1&&i!==2,period:'unknown'},status:i===3?'rule-match':'visual-match',productKeywords:i===0?[{query:'界面测试关键词（非真实商品数据）',productId:'qa-fixture-0',evidence:'关键词：界面测试关键词（非真实商品数据）',pageUrl:'http://127.0.0.1:43211/',capturedAt:template.capturedAt}]:[]}));
}
if(process.argv.includes('--collection')){
  const template=fixture.items[0];
  fixture.items=Array.from({length:100},(_,i)=>({...template,salesSource:'provider-visible',id:'qa-capture-'+i,title:'界面测试采集商品 '+(i+1)+'（非真实查询数据）',status:'pending',autoAttempt:1,subjectAttempt:1}));
  fixture.collection={source:'provider',tabId:0,status:'paused',reason:'limit-reached',limit:100,analysisTotal:100,total:100,productIds:fixture.items.map(item=>item.id),pageKeys:['界面测试结果页1','界面测试结果页2'],queryKey:'qa-only',query:'界面测试'};
  fixture.collectionHistory=[];
  fixture.pages=[{url:'http://127.0.0.1:43211/?qa-page=1'},{url:'http://127.0.0.1:43211/?qa-page=2'}];
}
const bootstrap=`const fixture=${JSON.stringify(fixture)}; globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{onChanged:{addListener:()=>{}},session:{get:async()=>({'temuMatch:1':fixture}),set:async()=>{}},local:{get:async()=>({})}},runtime:{openOptionsPage:async()=>{}},tabs:{}}; globalThis.fetch=async()=>({ok:true,json:async()=>({engine:'local',model:{state:'ready',message:'界面测试 · 无真实查询',progress:100}})});await import('/panel.js');`;
const server=http.createServer(async(req,res)=>{
  const name=new URL(req.url,'http://127.0.0.1:43211').pathname.slice(1);
  if(name==='qa.mjs'){res.setHeader('Content-Type','text/javascript');res.end(bootstrap);return;}
  if(!name){res.setHeader('Content-Type','text/html');res.end((await readFile(new URL('panel.html',root),'utf8')).replace('src="panel.js"','src="qa.mjs"').replace('<h1>TEMU 同款助手</h1>','<h1>界面校验 · 测试数据</h1>'));return;}
  if(!files.has(name)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',/\.(?:js|mjs)$/.test(name)?'text/javascript':/\.css$/.test(name)?'text/css':/\.png$/.test(name)?'image/png':'text/html');res.end(await readFile(new URL(name,root)));
});
server.listen(43211,'127.0.0.1',()=>console.log('UI fixture: http://127.0.0.1:43211/'));
