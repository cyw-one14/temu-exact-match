import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {projectRoot} from './service-runtime.mjs';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
try{
  const folder=process.argv.find(arg=>arg.startsWith('--directory='))?.slice(12);
  const command="$ErrorActionPreference='Continue'; & "+quote(process.execPath)+' '+quote(path.join(projectRoot,'scripts/service-control.mjs'))+" start --open-setup *> "+quote(path.join(projectRoot,'.cache/desktop-start.log'))+"; if($LASTEXITCODE -ne 0){Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('助手暂时没有启动成功，请重新运行安装程序修复。','TEMU同款助手') | Out-Null}";
  // WScript can truncate long Arguments. Keep paths single-quoted in a compact
  // fixed command instead of inflating the whole launcher as UTF-16 base64.
  if(command.includes('"'))throw Error('Invalid launcher command');
  const args='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "'+command+'"';
  const script=`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$taskDesktop=${folder?quote(path.resolve(folder)):"[Environment]::GetFolderPath('Desktop')"}
if(-not (Test-Path -LiteralPath $taskDesktop -PathType Container)){throw 'Cannot locate shortcut directory'}
$taskLink=Join-Path $taskDesktop '启动TEMU同款助手.lnk'
$taskTarget=Join-Path $PSHOME 'powershell.exe'
$taskRoot=${quote(path.resolve(projectRoot))}
$taskDescription='TEMU Exact Match local service launcher'
$taskShell=New-Object -ComObject WScript.Shell
$taskShortcut=$taskShell.CreateShortcut($taskLink)
if((Test-Path -LiteralPath $taskLink) -and ($taskShortcut.Description -ne $taskDescription -or $taskShortcut.WorkingDirectory -ne $taskRoot -or $taskShortcut.TargetPath -ne $taskTarget)){throw 'Existing desktop shortcut belongs to another project; it was not changed'}
$taskShortcut.TargetPath=$taskTarget
$taskShortcut.Arguments=${quote(args)}
$taskShortcut.WorkingDirectory=$taskRoot
$taskShortcut.Description=$taskDescription
$taskShortcut.WindowStyle=7
$taskShortcut.IconLocation=Join-Path $env:SystemRoot 'System32\\shell32.dll,14'
$taskShortcut.Save()
$taskSaved=$taskShell.CreateShortcut($taskLink)
if($taskSaved.Arguments -ne ${quote(args)}){throw 'Desktop launcher was truncated; installation path is too long'}
@{shortcutPath=$taskLink;projectRoot=$taskRoot}|ConvertTo-Json -Compress
`;
  console.log((await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000})).stdout.trim());
}catch(error){console.error(error.stderr?.trim()||error.message);process.exitCode=1;}
