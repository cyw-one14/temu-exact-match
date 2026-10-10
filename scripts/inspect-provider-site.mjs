// Read public frontend resources as text. Do not execute code or make authenticated/API requests.
const entry='https://www.temaishuju.com/plugin/search-image';
const response=await fetch(entry,{signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('Public page HTTP '+response.status);
const html=await response.text();
const script=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match=>match[1]).find(url=>url.startsWith('https://res.geekerp.com/')&&url.includes('/assets/index-'));
if(!script)throw new Error('No public app entry script');
const source=await(await fetch(script,{signal:AbortSignal.timeout(15000)})).text();
const route=source.match(/path:"\/plugin\/search-image",component:[^;]{0,100}?import\("([^\"]+)"\)/);
if(!route)throw new Error('No image-search route component');
const componentURL=new URL(route[1],script).href;
const component=await(await fetch(componentURL,{signal:AbortSignal.timeout(15000)})).text();
console.log(JSON.stringify({componentURL,bytes:component.length}));
const temuAt=component.indexOf('__name:"temu"'),temuEnd=component.indexOf('__name:',temuAt+20);
const temu=component.slice(temuAt,temuEnd>temuAt?temuEnd:temuAt+60000);
for(const term of ['FH=','搜索关键词','搜索词','推荐关键词']){
  let cursor=0;
  for(let i=0;i<4;i++){const at=component.indexOf(term,cursor);if(at<0)break;cursor=at+term.length;console.log(JSON.stringify({term,context:component.slice(Math.max(0,at-300),at+550)}));}
}
