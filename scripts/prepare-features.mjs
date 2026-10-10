import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile),root=new URL('../',import.meta.url);
const directory=fileURLToPath(new URL('.cache/feature-runtime/',root));
await run(process.env.TEMU_FEATURE_BOOTSTRAP_PYTHON||'python',['-m','venv',directory],{windowsHide:true});
const executable=fileURLToPath(new URL(process.platform==='win32'?'.cache/feature-runtime/Scripts/python.exe':'.cache/feature-runtime/bin/python',root));
const result=await run(executable,['-m','pip','install','--disable-pip-version-check','-r',fileURLToPath(new URL('server/feature-requirements.txt',root))],{windowsHide:true,maxBuffer:1000000});
console.log(result.stdout);console.log('本机快速核验依赖已准备好，重新启动服务后生效。');
