import {readFile,cp,mkdir,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
export async function copyNativeDependencies(root,target){
  const placed=new Map(),rows=[];
  function packagePath(require,name){
    try{return require.resolve(name+'/package.json');}catch(error){
      // sharp's platform packages export metadata as /package, without .json.
      try{return require.resolve(name+'/package');}catch{}
      let dir=path.dirname(require.resolve(name));for(let i=0;i<8;i++,dir=path.dirname(dir))try{const file=path.join(dir,'package.json'),p=require(file);if(p.name===name)return file;}catch{}
      throw error;
    }
  }
  async function copy(name,parent,optional=false,parentDestination=target){
    let file,meta;try{file=packagePath(createRequire(parent),name);meta=JSON.parse(await readFile(file,'utf8'));}catch(error){if(optional)return;throw error;}
    if(meta.os&&!meta.os.includes('win32')||meta.cpu&&!meta.cpu.includes('x64')){if(optional)return;throw Error('Unsupported native dependency '+name);}
    let conflict=false;
    for(let directory=parentDestination;directory.startsWith(target);directory=path.dirname(directory)){
      const installed=placed.get(path.join(directory,'node_modules',...name.split('/')));if(installed){if(installed===meta.version)return;conflict=true;break;}if(directory===target)break;
    }
    const destination=path.join(conflict?parentDestination:target,'node_modules',...name.split('/'));
    if(placed.has(destination)){if(placed.get(destination)===meta.version)return;throw Error('Cannot preserve dependency version '+name);}
    placed.set(destination,meta.version);const source=await realpath(path.dirname(file));await mkdir(path.dirname(destination),{recursive:true});
    await cp(source,destination,{recursive:true,dereference:true,filter:location=>{
      const relative=path.relative(source,location).replaceAll('\\','/');
      if(relative.split('/').some(part=>part==='node_modules'||part==='.git'||part==='.cache'))return false;
      if(name==='onnxruntime-node'&&relative.startsWith('bin/')&&!('bin/napi-v3/win32/x64/'.startsWith(relative+'/')||relative.startsWith('bin/napi-v3/win32/x64/')))return false;
      return true;
    }});
    rows.push({name,version:meta.version,path:path.relative(target,destination).replaceAll('\\','/')});
    for(const dependency of Object.keys(meta.dependencies||{}))await copy(dependency,file,false,destination);
    for(const dependency of Object.keys(meta.optionalDependencies||{}))await copy(dependency,file,true,destination);
  }
  for(const name of ['@huggingface/transformers','sharp'])await copy(name,path.join(root,'package.json'));
  return rows;
}
