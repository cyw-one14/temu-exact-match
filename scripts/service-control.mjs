import {startService,stopService} from './service-runtime.mjs';
try{
  const operation=process.argv[2];
  if(operation==='start')await startService({showSetup:process.argv.includes('--open-setup')});
  else if(operation==='stop')await stopService();
  else throw new Error('操作无效，需要 start 或 stop');
}catch(error){console.error(error.message);process.exitCode=1;}
