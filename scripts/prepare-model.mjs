import {prepareSubjects as prepareModel,subjectState as modelState} from '../server/subjects.mjs';
const timer=setInterval(()=>console.log(JSON.stringify(modelState)),10000);
try { await prepareModel(); console.log('Local subject matching models ready.'); }
catch(error){ console.error(error.message);if(error.cause)console.error(error.cause.code||error.cause.message);process.exitCode=1; }
finally { clearInterval(timer); }
