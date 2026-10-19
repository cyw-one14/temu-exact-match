import {availableParallelism} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const NATIVE_REVISION='native-512-fp32-v1';
export const nativeDevice=process.env.TEMU_SUBJECT_DEVICE==='dml'?'dml':'cpu';
export const nativeThreads=Math.max(1,Math.min(8,Number(process.env.TEMU_SUBJECT_THREADS)||Math.min(4,availableParallelism())));
const packaged=new URL('../runtime/models/',import.meta.url);
export const modelDirectory=fileURLToPath(existsSync(packaged)?packaged:new URL('../extension/models/',import.meta.url));
export function configureNative(lib){
  lib.env.allowRemoteModels=false;lib.env.allowLocalModels=true;lib.env.localModelPath=modelDirectory;lib.env.useFSCache=false;
}
export const sessionOptions={intraOpNumThreads:nativeThreads,interOpNumThreads:1};
