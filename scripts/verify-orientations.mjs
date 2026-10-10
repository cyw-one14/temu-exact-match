import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {comparePreparedFeatures,closeFastFeatures} from '../server/fast-features.mjs';
const template=await readFile(new URL('../tests/fixtures/features/glove-subject.png',import.meta.url)),rows=[];
try{
  for(const [mirror,rotation]of [[false,0],[true,0],[false,90],[false,180],[false,270],[true,90],[true,180],[true,270],[true,27]]){
    let buffer=template;if(mirror)buffer=await sharp(buffer).flop().png().toBuffer();
    if(rotation)buffer=await sharp(buffer).rotate(rotation,{background:'#ffffff00'}).png().toBuffer();
    buffer=await sharp(buffer).flatten({background:'#fff'}).jpeg({quality:80}).toBuffer();
    const started=performance.now(),match=await comparePreparedFeatures(template,buffer);
    rows.push({mirror,rotation,matched:match.matched,orientation:match.orientation,attempts:match.orientationAttempts?.length,elapsedMs:Math.round(performance.now()-started)});
    console.log(JSON.stringify(rows.at(-1)));assert.equal(match.matched,true);
  }
  const bad=await sharp(template).flop().modulate({hue:160}).flatten({background:'#fff'}).png().toBuffer();
  assert.equal((await comparePreparedFeatures(template,bad)).matched,false);
  await writeFile(new URL('../.cache/subject-validation/orientation-report.json',import.meta.url),JSON.stringify(rows,null,2));
}finally{closeFastFeatures();}
