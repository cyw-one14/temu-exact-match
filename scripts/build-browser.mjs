import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const transformers=path.resolve(path.dirname(require.resolve('@huggingface/transformers')),'../dist/transformers.web.js');
const aliases={'sharp':'browser/sharp.mjs','node:crypto':'browser/crypto.mjs','node:url':'browser/url.mjs','@huggingface/transformers':'browser/transformers.mjs','@temu/transformers-web':transformers};
await build({entryPoints:[path.join(root,'browser/engine.mjs')],outfile:path.join(root,'extension/browser-engine.bundle.js'),bundle:true,platform:'browser',format:'iife',globalName:'TemuBrowserEngine',target:'chrome116',minify:true,legalComments:'eof',inject:[path.join(root,'browser/polyfills.mjs')],define:{'import.meta.url':'self.location.href'},plugins:[{
  name:'reuse-validated-pipeline',setup(build){
    build.onResolve({filter:/.*/},args=>{if(aliases[args.path])return {path:path.resolve(root,aliases[args.path])};if(/(?:^|\/)native-runtime\.mjs$/.test(args.path))return {path:path.join(root,'browser/native-runtime.mjs')};if(/(?:^|\/)descriptor-cache\.mjs$/.test(args.path))return {path:path.join(root,'browser/descriptor-cache.mjs')};if(/(?:^|\/)fast-features\.mjs$/.test(args.path))return {path:path.join(root,'browser/fast-features.mjs')};});
    build.onLoad({filter:/server[\\/](?:subjects|product-attention|vision)\.mjs$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll("device:'cpu'","device:'wasm'").replaceAll('下载主体模型 ','加载内置模型 ').replaceAll('onnx-community/BiRefNet_lite-ONNX','studioludens/birefnet-lite-512').replaceAll('de15b22ba131738a16dff04aab8bdf8dc32e3ac1','962e67969ec6acec9c19fab76acee4f5e22e990c').replace('outputs.output_image[0]','(outputs.logits||outputs.output_image)[0]').replace('const outputs=await segment({input_image:inputs.pixel_values});',"let outputs;try{outputs=await segment({input_image:inputs.pixel_values});}catch(error){subjectState.state='error';subjectState.message='内置识别计算未完成，请重试或释放内存';throw Error('浏览器识别初始化失败：主体分割推理失败，请确认浏览器图形加速可用或释放内存后重试：'+String(error?.message||error));}"),loader:'js'}));
  }
}]});
console.log('Browser image engine bundled.');
