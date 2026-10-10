import {readFile,writeFile} from 'node:fs/promises';
import {subjectDescriptor,prepareSubjects} from '../server/subjects.mjs';
const results=[];
const start=performance.now();await prepareSubjects();
console.log(JSON.stringify({modelLoadMs:Math.round(performance.now()-start)}));
for(const name of ['same-subject-new-background','rotated-subject']){
  const buffer=await readFile(new URL('../.cache/subject-validation/'+name+'.png',import.meta.url));
  const begin=performance.now(),descriptor=await subjectDescriptor(buffer);
  const row={name,elapsedMs:Math.round(performance.now()-begin),valid:descriptor.valid};
  results.push(row);console.log(JSON.stringify(row));
}
await writeFile(new URL('../.cache/subject-validation/benchmark-'+(process.env.TEMU_SUBJECT_DEVICE||process.env.TEMU_SUBJECT_THREADS||'default')+'.json',import.meta.url),JSON.stringify(results,null,2));
