// Only normal search-result controls; never click product links or paid upsells.
(() => {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const visible=node=>{
    if(!node||node.closest('[hidden],[aria-hidden="true"]'))return false;
    if(typeof getComputedStyle==='function')for(let parent=node;parent&&parent.nodeType===1;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;}
    return true;
  };
  const disabled=node=>Boolean(node.closest('[disabled],[aria-disabled="true"],.disabled,.is-disabled,.ant-pagination-disabled'));
  const pageParam=/^(?:page|pageNum|pageNo|pageNumber|currentPage|current|page_number|page_num|offset|cursor)$/i;
  function queryKey(url){return url.origin+url.pathname+'?'+[...url.searchParams].filter(([key])=>!pageParam.test(key)).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&');}
  globalThis.temuResultNavigation=(options={})=>{
    const current=new URL(location.href),provider=current.origin==='https://www.temaishuju.com';
    const tabs=[...document.querySelectorAll('[role="tab"][aria-selected="true"],.ant-tabs-tab-active')].filter(visible).map(node=>clean(node.textContent));
    const temuTab=tabs.length?tabs.some(value=>/^temu$/i.test(value)):!current.searchParams.has('platform')||/^temu$/i.test(current.searchParams.get('platform'));
    const supported=provider?current.pathname==='/plugin/search-image'&&temuTab:current.origin==='https://www.temu.com'&&current.pathname==='/search_result.html';
    const key=queryKey(current),body=clean(document.body?.innerText||document.body?.textContent);
    const blocked=/captcha|verify (?:that )?you are human|安全验证|人机验证|访问过于频繁|access denied|403 forbidden|请先登录|登录后|login required/i.test(body.slice(0,20000));
    const anchors=[...document.querySelectorAll('a[href]')].filter(node=>visible(node)&&/(?:-g-\d+\.html|[?&](?:goods_id|goodsId)=\d+)/.test(node.getAttribute('href')||''));
    // Walk the product's own scroll container, preserving virtual-list windows.
    let scroller=document.scrollingElement||document.documentElement;
    for(let node=anchors[0]?.parentElement;node&&node!==document.body;node=node.parentElement){
      if(node.scrollHeight>node.clientHeight+4&&node.clientHeight>100&&typeof getComputedStyle==='function'&&/auto|scroll/.test(getComputedStyle(node).overflowY)){scroller=node;break;}
    }
    const height=scroller.scrollHeight||0,viewport=scroller.clientHeight||globalThis.innerHeight||0,position=scroller.scrollTop||0;
    const atBottom=height<=viewport+position+4;
    const loading=[...document.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.el-loading-mask,[role="progressbar"]')].some(visible);
    const pagers=['.pagination','.el-pagination','.ant-pagination','.n-pagination','nav[aria-label*="pagination" i]','nav[aria-label*="分页"]','[role="navigation"][aria-label*="pagination" i]'];
    let next=null,nextKind='',endEvidence='';
    const candidates=[...document.querySelectorAll(pagers.flatMap(root=>[root+' button',root+' a',root+' [role="button"]']).join(',')+',.el-pagination .btn-next,.ant-pagination-next,[data-load-more]')];
    for(const node of document.querySelectorAll('button,[role="button"]'))if(/^(?:加载更多|载入更多|load more|show more results)$/i.test(clean(node.textContent)))candidates.push(node);
    for(const node of candidates){
      if(!visible(node))continue;
      const label=clean(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent);
      const kind=node.matches('.btn-next,.ant-pagination-next')||/^(?:下一页|下页|next(?: page)?|[›»→])$/i.test(label)?'next':/^(?:加载更多|载入更多|load more|show more results)$/i.test(label)?'more':'';
      if(!kind)continue;
      const href=node.getAttribute('href');
      if(href&&href!=='#'){
        let target;try{target=new URL(href,current);}catch{continue;}
        if(target.protocol!=='https:'||queryKey(target)!==key||target.href===current.href)continue;
      }
      if(disabled(node)){endEvidence||='下一页 / 加载更多控件已禁用';continue;}
      next=node;nextKind=kind;break;
    }
    // Exact end markers only. The whole page can include other lists/ads.
    for(const node of document.querySelectorAll('[data-results-end],.no-more,.no-more-data,.end-of-results,.list-footer,p,span,div')){
      if(node.children.length||!visible(node))continue;
      const text=clean(node.textContent);
      if(/^(?:没有更多(?:商品|结果|数据)?了?|已(?:显示|加载)全部(?:商品|结果|数据)|到底了|no more (?:products|results|items)|you.ve (?:seen|reached) (?:all|the end)(?:.*results)?)?[.!。！]?$/i.test(text)&&text){endEvidence=text;break;}
    }
    if(next)endEvidence='';
    const active=document.querySelector('.el-pager .active,.ant-pagination-item-active,[aria-current="page"]');
    const pageKey=current.href+'#result-page='+clean(active?.textContent);
    const snapshot={supported,queryKey:key,pageKey,position,height,atBottom,loading,nextKind,nextKey:next?nextKind+':'+clean(next.getAttribute('href')||next.textContent||next.getAttribute('aria-label')):'',endEvidence};
    if(!options.advance)return snapshot;
    if(!supported||blocked||options.queryKey!==key)return {...snapshot,action:'blocked',reason:blocked?'challenge':'query-changed'};
    if(loading)return {...snapshot,action:'wait'};
    if(!anchors.length)return {...snapshot,action:'wait'};
    if(!atBottom){scroller.scrollTop=Math.min(height-viewport,position+Math.max(100,Math.floor(viewport*.8)));return {...snapshot,action:'scroll'};}
    if(next){next.click();return {...snapshot,action:nextKind};}
    return {...snapshot,action:'wait'};
  };
  return globalThis.temuResultNavigation();
})();
