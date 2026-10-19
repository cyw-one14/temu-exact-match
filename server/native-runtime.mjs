import {availableParallelism} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const NATIVE_REVISION='native-512-fp32-v1';
export const nativeDevice=process.env.TEMU_SUBJECT_DEVICE==='dml'?'dml':'cpu';
// One segment lane uses the CPU budget; the two small-model lanes use one
// thread each. Avoid three copies of the same heavy graph competing for cores.
export const nativeWorkers=nativeDevice==='cpu'?Math.max(1,Math.min(3,availableParallelism(),Math.floor(Number(process.env.TEMU_SUBJECT_WORKERS)||3))):1;
export const nativeThreads=Math.max(1,Math.min(8,Math.floor(Number(process.env.TEMU_SUBJECT_THREADS)||Math.max(1,Math.min(4,availableParallelism()-nativeWorkers+1)))));
const packaged=new URL('../runtime/models/',import.meta.url);
export const modelDirectory=fileURLToPath(existsSync(packaged)?packaged:new URL('../native/models/',import.meta.url));
export function configureNative(lib){
  lib.env.allowRemoteModels=false;lib.env.allowLocalModels=true;lib.env.localModelPath=modelDirectory;lib.env.useFSCache=false;
}
export const sessionOptions={intraOpNumThreads:nativeThreads,interOpNumThreads:1};
