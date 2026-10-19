import {readFile,writeFile,readdir,mkdir,copyFile,cp,lstat,rm} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {prepareNativeAssets,nativeAssets} from './prepare-native-assets.mjs';
import {copyNativeDependencies} from './copy-native-dependencies.mjs';
import {APP_ID,fileHash,verifyDistribution} from './distribution.mjs';
import {writeZip} from './zip.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function packageNative(){
  await prepareNativeAssets();
  const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid distribution version');
  const stage=path.resolve(root,'.cache','native-build-'+version);
  if(!stage.startsWith(path.resolve(root,'.cache')+path.sep))throw Error('Unsafe generated stage');
  // This exact scratch directory belongs to this build; installed/user data
  // lives elsewhere and is never removed when preparing a fresh package.
  await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
  const roots=JSON.parse(await readFile(path.join(root,'native/extension-files.json'),'utf8'));
  await copyFile(path.join(root,'安装说明.md'),path.join(root,'extension','安装说明.txt'));
  for(const name of ['core','provider','prices','listing','title-match','collection'])await copyFile(path.join(root,'shared',name+'.mjs'),path.join(root,'extension',name+'.mjs'));
  const copy=async(relative,source=path.join(root,relative))=>{const file=path.join(stage,relative);await mkdir(path.dirname(file),{recursive:true});await copyFile(source,file);};
  for(const name of roots)await copy('extension/'+name);
  for(const directory of ['server','shared'])for(const name of await readdir(path.join(root,directory)))if(/\.(?:mjs|py|txt|html|css|js)$/.test(name))await copy(directory+'/'+name);
  for(const name of ['service-runtime','service-control','service-autostart','distribution','install-local'])await copy('scripts/'+name+'.mjs');
  await copy('browser/photo-cache.mjs');
  await copy('package.json');await copy('安装说明.md');
  await copy('native/runtime-lock.json');
  for(const row of JSON.parse(await readFile(path.join(root,'browser/model-lock.json'),'utf8')).files)await copy('runtime/'+row.path,path.join(root,'extension',row.path));
  const pythonRoot=path.join(nativeAssets,'python');
  await cp(pythonRoot,path.join(stage,'runtime/python'),{recursive:true,filter:file=>!path.relative(pythonRoot,file).split(path.sep).some(part=>part==='__pycache__'||/\.pyc$/.test(part))});
  await cp(path.join(nativeAssets,'node'),path.join(stage,'runtime/node'),{recursive:true});
  for(const name of ['vcruntime140.dll','vcruntime140_1.dll'])await copy('runtime/node/'+name,path.join(nativeAssets,'python',name));
  await cp(path.join(root,'browser/licenses'),path.join(stage,'licenses'),{recursive:true});
  const dependencies=await copyNativeDependencies(root,stage);
  // Exercise the copied dependency closure using the shipped runtime. A hash
  // inventory alone cannot detect missing platform-specific optional packages.
  await promisify(execFile)(path.join(stage,'runtime/node/node.exe'),['--input-type=module','-e',"await import('@huggingface/transformers'); const {default:sharp}=await import('sharp'); await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();"],{cwd:stage,windowsHide:true,timeout:30000});
  await writeFile(path.join(stage,'Install-TEMU.cmd'),'@echo off\r\n"%~dp0runtime\\node\\node.exe" "%~dp0scripts\\install-local.mjs"\r\nif errorlevel 1 pause\r\n');
  await writeFile(path.join(stage,'Start-TEMU.cmd'),'@echo off\r\nif not exist "%LOCALAPPDATA%\\TemuExactMatch\\.local-install.json" (\r\n  call "%~dp0Install-TEMU.cmd"\r\n  exit /b\r\n)\r\n"%LOCALAPPDATA%\\TemuExactMatch\\runtime\\node\\node.exe" "%LOCALAPPDATA%\\TemuExactMatch\\scripts\\service-control.mjs" start --open-setup\r\nif errorlevel 1 pause\r\n');
  const files=[];
  async function inventory(directory=''){for(const entry of await readdir(path.join(stage,directory),{withFileTypes:true})){const name=(directory?directory+'/':'')+entry.name;if(name==='native-package.json')continue;if(entry.isSymbolicLink()||name.split('/').some(part=>['.cache','__pycache__','.git'].includes(part)||part.startsWith('.env')||part.startsWith('.local-')))throw Error('Unexpected package file '+name);if(entry.isDirectory())await inventory(name);else files.push({path:name,bytes:(await lstat(path.join(stage,name))).size,sha256:await fileHash(path.join(stage,name))});}}
  await inventory();files.sort((a,b)=>a.path.localeCompare(b.path));
  await writeFile(path.join(stage,'native-package.json'),JSON.stringify({appId:APP_ID,version,platform:'win32-x64',runtime:'native-local-v1',dependencies,files},null,2));
  await verifyDistribution(stage);
  const dist=path.join(root,'dist');await mkdir(dist,{recursive:true});
  const zip=path.join(dist,'temu-exact-match-'+version+'-windows-x64.zip'),size=await writeZip(stage,[...files.map(row=>row.path),'native-package.json'],zip);
  await writeFile(zip+'.sha256',(await fileHash(zip))+'  '+path.basename(zip)+'\n');
  const extensionZip=path.join(dist,'temu-exact-match-extension.zip');await writeZip(path.join(root,'extension'),roots,extensionZip);
  console.log(JSON.stringify({version,stage,files:files.length+1,bytes:size,zip},null,2));
  return stage;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await packageNative();
