import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';

test('reference warmup does not block image results and replacing an idle selection cancels the old preparation',async()=>{
  const {document,window}=parseHTML(await readFile(new URL('../extension/panel.html',import.meta.url),'utf8'));
  globalThis.document=document;globalThis.window=window;
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const saved={matchingPolicy:'title-groups-outline-v16',engineRevision:'native-512-fp32-v1',matchRevision:1,referenceImage:image,referenceSpecs:{},referenceContext:{collectionRevision:'declared-product-v1',title:'TEST captured reference'},profile:{name:'TEST reference'},items:[{id:'601123456789001',title:'TEST candidate',imageUrl:'https://img.kwcdn.com/test-candidate.jpg',url:'https://www.temu.com/goods.html?goods_id=601123456789001',status:'unreviewed',salesSource:'provider-visible'}],keywords:[],selectedQueries:[],pages:[],collectionHistory:[]};
  const listeners=[],warm=[],comparisons=[];let release;
  globalThis.chrome={windows:{getCurrent:async()=>({id:1})},storage:{session:{get:async()=>({'temuMatch:1':saved}),set:async()=>{}},local:{get:async()=>({preferences:{onImageClick:'local'}})},onChanged:{addListener:fn=>listeners.push(fn)}},tabs:{create:()=>assert.fail('warmup must not navigate')},runtime:{sendMessage:async()=>({ok:true})}};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return {ok:true,json:async()=>({engine:'local',engineRevision:'native-512-fp32-v1',model:{state:'ready'}})};
    const body=JSON.parse(options.body);
    if(url.endsWith('/prefetch')){
      if(body.referenceImage){warm.push({body,signal:options.signal});return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({ok:true})});});}
      return {ok:true,json:async()=>({ok:true})};
    }
    comparisons.push(body);return {ok:true,json:async()=>({ok:true,comparison:{status:'visual-match',samePhoto:true,imageSimilarity:1,subject:null,evidence:['TEST same photo']}})};
  };
  const until=async check=>{for(let i=0;i<500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('UI timed out');};
  try{
    await import('../extension/panel.js?reference-warmup');
    await until(()=>warm.length===1&&document.getElementById('exact-results').children.length===1&&!document.getElementById('analyze').disabled);
    assert.equal(warm[0].body.referenceImage,image);assert.equal(warm[0].body.referenceTitle,'TEST captured reference');
    assert.ok(comparisons.some(body=>body.phase==='page-match'),'results do not await optional preparation');
    assert.equal(warm[0].signal.aborted,false);
    listeners[0]({'temuSelection:1':{newValue:{id:'NEW',windowId:1,imageUrl:'https://img.kwcdn.com/new-selection.jpg',title:'TEST new selection'}}},'session');
    await until(()=>warm[0].signal.aborted);
    release();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(document.getElementById('exact-results').children.length,0,'old preparation cannot restore old results');
  }finally{release?.();window.dispatchEvent(new window.Event('pagehide'));}
});
