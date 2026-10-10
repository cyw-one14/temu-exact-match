import {readFile} from 'node:fs/promises';
const directory='C:/Users/SHENG/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/iedlldhgenjgalcedekdkdjdalodkohb/1.8.1_0/';
const names=['background.js','temuContentScript.js','apiContentScript.js','unionContentScript.js','popup.js'];
for(const name of names){
  const source=await readFile(directory+name,'utf8');
  const counts=Object.fromEntries(['onMessageExternal','onConnectExternal','postMessage','imageId','image_id','imageid','base64','imageSearch','searchByImage','uploadImage','关键词'].map(term=>[term,source.split(term).length-1]));
  const urls=new Set();
  for(const match of source.matchAll(/https?:\/\/[^\s"'`<>]+/g)){
    try{const url=new URL(match[0]);urls.add(url.origin+url.pathname);}catch{}
  }
  const snippets=[];
  for(const term of ['onMessageExternal','imageId','image_id','imageid','imageSearch','searchByImage','uploadImage']){
    let cursor=0;
    for(let n=0;n<3;n++){
      const at=source.indexOf(term,cursor);if(at<0)break;cursor=at+term.length;
      const text=source.slice(Math.max(0,at-120),at+220).replace(/["'][A-Za-z0-9+\/_=-]{60,}["']/g,'"[long literal omitted]"');
      snippets.push({term,text});
    }
  }
  const operations=[...new Set([...source.matchAll(/"([A-Za-z][A-Za-z0-9_-]{2,80})"(?:!==|===)[\w.$]+\.type|type:"([A-Za-z][A-Za-z0-9_-]{2,80})"/g)].map(match=>match[1]||match[2]))];
  const focused=[];
  if(['apiContentScript.js','background.js','temuContentScript.js'].includes(name))for(const term of ['"keyword-recommend"','"goods-list"','"temuRequest"','"getImageBase64"','"chromeSendMessage"','/plugin/search-image','api.temaishuju.com','image_key','image_search','image_upload']){
    let cursor=0;for(let i=0;i<3;i++){const at=source.indexOf(term,cursor);if(at<0)break;cursor=at+term.length;focused.push({term,text:source.slice(Math.max(0,at-100),at+450)});}
  }
  console.log(JSON.stringify({name,bytes:Buffer.byteLength(source),counts,operations:operations.filter(value=>/temu|image|keyword|goods|plugin|chromeSendMessage/i.test(value)),urls:[...urls].filter(url=>/tem[ua]|geek|pinduoduo|1688/.test(url)).slice(0,70),focused}));
}
