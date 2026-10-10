import {prepareSubjects,subjectState} from '../server/subjects.mjs';
const timer=setInterval(()=>console.log(JSON.stringify(subjectState)),10000);
try{await prepareSubjects();console.log('Subject models ready.');}catch(error){console.error(error);process.exitCode=1;}finally{clearInterval(timer);}
