import {readFile} from 'node:fs/promises';
import {prepareModel} from '../server/vision.mjs';
const {processor,model,RawImage}=await prepareModel();
const image=await RawImage.fromBlob(new Blob([await readFile(new URL('../test-output/real-bottle.webp',import.meta.url))]));
for(const question of ['What is the object in this image?','Describe this image.','Describe the shape and color of this product.']){
  const prompt=processor.apply_chat_template([{role:'user',content:[{type:'image'},{type:'text',text:question}]}],{add_generation_prompt:true});
  const inputs=await processor(prompt,[image]);
  const outputs=await model.generate({...inputs,max_new_tokens:60,do_sample:false});
  const answer=processor.batch_decode(outputs.slice(null,[inputs.input_ids.dims.at(-1),null]),{skip_special_tokens:true})[0];
  console.log(JSON.stringify({question,answer,dimensions:inputs.pixel_values.dims,imageTokens:inputs.input_ids.dims.at(-1)}));
}
