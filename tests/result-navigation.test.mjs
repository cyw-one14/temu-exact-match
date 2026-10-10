import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../extension/result-navigation.js',import.meta.url),'utf8');
const product='<a href="https://www.temu.com/gloves-g-601123456789001.html"><img src="https://img.kwcdn.com/a.jpg">Actual gloves</a>';
function setup(html,url='https://www.temu.com/search_result.html?search_key=gloves&page=1',metrics={}){
  const {document}=parseHTML('<html><body>'+product+html+'</body></html>');
  Object.assign(document.documentElement,{scrollHeight:1000,clientHeight:1000,scrollTop:0,...metrics});
  const clicks=[];for(const node of document.querySelectorAll('a,button,li'))node.click=()=>clicks.push(node);
  const context=vm.createContext({document,location:new URL(url),URL,Date,Map,Set,String,Array,RegExp,Number});
  const snapshot=vm.runInContext(source,context);return {document,clicks,snapshot,advance:options=>context.temuResultNavigation({advance:true,queryKey:snapshot.queryKey,...options})};
}
test('only same-query normal pagination can advance; product links and professional upsells are never clicked',()=>{
  const data=setup('<button>查看更多同款 (33)</button><nav class="pagination"><a href="/goods.html?goods_id=601123456789002">下一页</a><a href="/search_result.html?search_key=other&page=2">下一页</a><a href="/search_result.html?search_key=gloves&page=2">下一页</a></nav>');
  assert.equal(data.snapshot.nextKind,'next');assert.equal(data.advance().action,'next');assert.equal(data.clicks.length,1);assert.equal(data.clicks[0].getAttribute('href'),'/search_result.html?search_key=gloves&page=2');
});
test('scroll is incremental and captures virtualized windows before reaching next controls',()=>{
  const data=setup('<nav class="pagination"><button>下一页</button></nav>',undefined,{scrollHeight:5000,clientHeight:1000,scrollTop:0});
  assert.equal(data.advance().action,'scroll');assert.equal(data.document.documentElement.scrollTop,800);assert.equal(data.clicks.length,0);
});
test('end controls, hidden controls, login, loading, changed query and non-search routes do not navigate',()=>{
  const end=setup('<nav class="pagination"><button disabled>下一页</button><button hidden>下一页</button></nav>');assert.equal(end.snapshot.nextKind,'');assert.match(end.snapshot.endEvidence,/禁用/);assert.equal(end.advance().action,'wait');
  const loading=setup('<button data-load-more>加载更多</button><div aria-busy="true"></div>');assert.equal(loading.advance().action,'wait');assert.equal(loading.clicks.length,0);
  const login=setup('<p>请先登录</p><button>加载更多</button>');assert.equal(login.advance().action,'blocked');assert.equal(login.clicks.length,0);
  const changed=setup('<button>加载更多</button>');assert.equal(changed.advance({queryKey:'other'}).action,'blocked');assert.equal(changed.clicks.length,0);
  const detail=setup('<button>加载更多</button>','https://www.temu.com/goods.html?goods_id=601123456789001');assert.equal(detail.snapshot.supported,false);assert.equal(detail.advance().action,'blocked');
});
test('provider supports only the Temu tab, preserves image/title in the query and follows a scoped next control',()=>{
  const url='https://www.temaishuju.com/plugin/search-image?platform=temu&url=https%3A%2F%2Fimg.kwcdn.com%2Fa.jpg&title=Actual+gloves';
  const data=setup('<div role="tab" aria-selected="true">Temu</div><div class="ant-pagination"><li class="ant-pagination-next" title="Next Page">›</li></div>',url);assert.equal(data.advance().action,'next');assert.match(data.snapshot.queryKey,/title=Actual%20gloves/);
  const other=setup('<div role="tab" aria-selected="true">淘宝</div><button>加载更多</button>',url);assert.equal(other.advance().action,'blocked');assert.equal(other.clicks.length,0);
});
