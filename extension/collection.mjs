// Exhaust the normally displayed search result, without inventing a site-wide total.
export function createCollection({source,tabId,queryKey='',query='',now=Date.now()}={}){
  return {source,tabId,queryKey,query,status:'running',reason:'',startedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),total:0,productIds:[],pageKeys:[],advances:0,lastActivity:now,lastView:'',pending:null};
}
export function pauseCollection(job,reason){job.status='paused';job.reason=reason;job.pending=null;return job;}
export function resumeCollection(job,now=Date.now()){job.status='running';job.reason='';job.lastActivity=now;job.lastView='';job.pending=null;return job;}
export function collectionDecision(job,page,{total=job.total,now=Date.now()}={}){
  if(job.status!=='running')return 'paused';
  job.updatedAt=new Date(now).toISOString();
  const nav=page.navigation;
  if(page.challenge||page.state==='challenge'){pauseCollection(job,'challenge');return 'paused';}
  if(page.state==='login'){pauseCollection(job,'login');return 'paused';}
  if(page.state==='unsupported'||(nav&&!nav.supported)){pauseCollection(job,'unsupported');return 'paused';}
  if(!nav){pauseCollection(job,'navigation-unavailable');return 'paused';}
  if(job.queryKey&&job.queryKey!==nav.queryKey){pauseCollection(job,'query-changed');return 'paused';}
  job.queryKey||=nav.queryKey;
  if(job.pending&&job.pending.pageKey!==nav.pageKey&&job.pageKeys.includes(nav.pageKey)&&total<=job.total){pauseCollection(job,'navigation-cycle');return 'paused';}
  if(!job.pageKeys.includes(nav.pageKey))job.pageKeys.push(nav.pageKey);
  const view=JSON.stringify([nav.pageKey,nav.position,nav.height,(page.products||[]).map(item=>[item.id,item.imageUrl,item.title]),nav.nextKey,nav.endEvidence]);
  if(total>job.total||view!==job.lastView){job.lastActivity=now;job.pending=null;job.lastView=view;}
  job.total=total;
  const idle=now-job.lastActivity;
  if(nav.loading){if(idle>=60000)pauseCollection(job,'loading-timeout');return job.status==='running'?'wait':'paused';}
  // Allow late rendering at the bottom. Explicit page evidence is still only
  // evidence about this search result, never about the complete marketplace.
  if(nav.atBottom&&nav.endEvidence&&idle>=4000){pauseCollection(job,'result-end');return 'paused';}
  if(job.pending){if(idle>=15000)pauseCollection(job,'stalled');return job.status==='running'?'wait':'paused';}
  if((page.products||[]).length&&(!nav.atBottom||nav.nextKind))return 'advance';
  if(idle>=15000){pauseCollection(job,page.products?.length?'stalled':'no-results');return 'paused';}
  return 'wait';
}
export function recordCollectionAdvance(job,result){
  if(result.action==='blocked')pauseCollection(job,result.reason||'query-changed');
  else if(result.action==='next'||result.action==='more'){job.advances++;job.pending={pageKey:job.pageKeys.at(-1)};}
}
export function collectionText(job){
  if(!job)return '采集当前页面已加载商品；搜索结果页支持继续滚动和翻页。';
  const reasons={'manual':'用户暂停，可继续采集','result-end':'页面已显示结束，当前搜索结果采集完毕','stalled':'页面暂未提供更多结果，可继续重试','navigation-cycle':'翻页回到已采集页面且没有新商品，已暂停重复循环','no-results':'暂未展示商品，请检查查询后继续','challenge':'需要在原页面完成验证后继续','login':'需要在原页面完成登录后继续','unsupported':'当前页面或平台不支持继续采集','navigation-unavailable':'页面未提供可识别的结果导航','query-changed':'查询或平台已改变，已停止混入其他结果','loading-timeout':'页面加载长时间未变化，可继续重试','tab-closed':'结果标签页已关闭','page-error':'页面读取失败，可继续重试','panel-closed':'侧栏关闭，采集已暂停'};
  return (job.source==='provider'?'特卖数据图搜':'TEMU 搜索')+' · 累计去重 '+job.total+' 条 · '+job.pageKeys.length+' 个结果页 · '+(job.status==='running'?'正在采集，继续加载页面结果':reasons[job.reason]||'采集已暂停')+'。全站覆盖未核实。';
}
