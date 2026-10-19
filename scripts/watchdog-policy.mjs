export class WatchdogPolicy{
  constructor({startedAt=Date.now(),loadingLimitMs=180000}={}){this.startedAt=startedAt;this.loadingLimitMs=loadingLimitMs;this.failures=0;}
  inspect(health,expected,now=Date.now()){
    const owned=health?.ok&&['version','extensionId','installationId'].every(key=>health[key]===expected[key]);
    if(owned&&health.model?.state==='ready'){this.failures=0;return null;}
    if(owned&&health.model?.state==='loading'&&now-this.startedAt<this.loadingLimitMs){this.failures=0;return null;}
    this.failures++;return this.failures>=3?(owned?'识别模块未就绪':'后台连续未响应'):null;
  }
}
export const restartDelay=failures=>[1000,3000,10000,30000,60000][Math.min(4,Math.max(0,failures-1))];
