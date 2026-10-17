// Only downloads/decoding overlap; all model and Python jobs stay serialized.
export class ImageLoader{
  constructor({decode,allowed,decodeData,fetchImage=fetch,parallel=3,capacity=64}){Object.assign(this,{decode,allowed,decodeData,fetchImage,parallel,capacity});this.cache=new Map();this.queue=[];this.active=0;}
  get(url){
    if(this.cache.has(url)){const job=this.cache.get(url);this.cache.delete(url);this.cache.set(url,job);return job;}
    const task=new Promise((resolve,reject)=>{this.queue.push({url,resolve,reject});});
    this.cache.set(url,task);if(this.cache.size>this.capacity)this.cache.delete(this.cache.keys().next().value);
    task.catch(()=>{if(this.cache.get(url)===task)this.cache.delete(url);});this.drain();return task;
  }
  prefetch(urls){for(const url of [...new Set(urls)].slice(0,this.parallel))this.get(url).catch(()=>{});}
  drain(){while(this.active<this.parallel&&this.queue.length){const {url,resolve,reject}=this.queue.shift();this.active++;this.read(url).then(resolve,reject).finally(()=>{this.active--;this.drain();});}}
  async read(url){
    let input;
    if(typeof url!=='string')throw Error('商品图片地址无效');
    if(url.startsWith('data:'))input=this.decodeData(url);
    else{
      if(!this.allowed(url))throw Error('只读取已抓取的 TEMU 官方商品图片');
      const response=await this.fetchImage(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('商品图片读取失败 HTTP '+response.status);
      if(Number(response.headers.get('content-length'))>8000000)throw Error('商品图片超过8 MB');
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8000000)throw Error('商品图片超过8 MB');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
      input=Buffer.concat(chunks);
    }
    return {buffer:await this.decode(input)};
  }
}
