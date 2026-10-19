// Cache image evidence only. Titles, product IDs, specs and verdicts are excluded.
export class PhotoCache{
  constructor(compare,{capacity=128}={}){this.compare=compare;this.capacity=capacity;this.rows=new Map();}
  async get(key,...inputs){
    let task=this.rows.get(key);
    if(!task){task=Promise.resolve().then(()=>this.compare(...inputs));this.rows.set(key,task);if(this.rows.size>this.capacity)this.rows.delete(this.rows.keys().next().value);task.catch(()=>{if(this.rows.get(key)===task)this.rows.delete(key);});}
    else{this.rows.delete(key);this.rows.set(key,task);}
    return structuredClone(await task);
  }
}
