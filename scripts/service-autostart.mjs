// Current-user Windows login startup. Uses the existing guarded service launcher.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {projectRoot,requireNodeVersion} from './service-runtime.mjs';

const operation=process.argv[2];
try{
  if(process.platform!=='win32')throw new Error('自动启动设置仅支持 Windows');
  if(!['enable','disable','status'].includes(operation))throw new Error('需要 enable、disable 或 status');
  requireNodeVersion();
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const root=path.resolve(projectRoot),launcher=path.join(root,'scripts','service-control.mjs');
  const command="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); & "+quote(process.execPath)+' '+quote(launcher)+" start *> "+quote(path.join(root,'.cache','autostart.log'))+'; exit $LASTEXITCODE';
  if(command.includes('"'))throw Error('Invalid startup command');
  const args='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "'+command+'"';
  const script=`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$taskRoot=${quote(root)}
$taskArguments=${quote(args)}
$taskOperation=${quote(operation)}
$taskDescription='TEMU Exact Match local service'
$taskTarget=Join-Path $PSHOME 'powershell.exe'
$taskStartup=[Environment]::GetFolderPath('Startup')
if(-not $taskStartup){throw 'Cannot locate the current user Startup folder'}
$taskLink=Join-Path $taskStartup 'TEMU Exact Match Service.lnk'
$taskShell=New-Object -ComObject WScript.Shell
$taskExists=Test-Path -LiteralPath $taskLink
$taskOwned=$false
if($taskExists){
  $taskShortcut=$taskShell.CreateShortcut($taskLink)
  $taskOwned=($taskShortcut.Description -eq $taskDescription -and $taskShortcut.WorkingDirectory -eq $taskRoot -and $taskShortcut.TargetPath -eq $taskTarget)
}
if($taskOperation -ne 'status' -and $taskExists -and -not $taskOwned){throw 'Existing startup shortcut belongs to another project; it was not changed'}
if($taskOperation -eq 'enable'){
  New-Item -ItemType Directory -Path (Join-Path $taskRoot '.cache') -Force | Out-Null
  New-Item -ItemType Directory -Path $taskStartup -Force | Out-Null
  $taskShortcut=$taskShell.CreateShortcut($taskLink)
  $taskShortcut.TargetPath=$taskTarget
  $taskShortcut.Arguments=$taskArguments
  $taskShortcut.WorkingDirectory=$taskRoot
  $taskShortcut.Description=$taskDescription
  $taskShortcut.WindowStyle=7
  $taskShortcut.Save()
}
if($taskOperation -eq 'disable' -and $taskOwned){Remove-Item -LiteralPath $taskLink}
$taskExists=Test-Path -LiteralPath $taskLink
$taskEnabled=$false
if($taskExists){
  $taskShortcut=$taskShell.CreateShortcut($taskLink)
  $taskEnabled=($taskShortcut.Description -eq $taskDescription -and $taskShortcut.WorkingDirectory -eq $taskRoot -and $taskShortcut.TargetPath -eq $taskTarget -and $taskShortcut.Arguments -eq $taskArguments)
}
if($taskOperation -eq 'enable' -and -not $taskEnabled){throw 'Startup launcher verification failed; installation path may be too long'}
@{enabled=$taskEnabled;shortcutPath=$taskLink;projectRoot=$taskRoot}|ConvertTo-Json -Compress
`;
  const result=await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000});
  console.log(result.stdout.trim());
}catch(error){console.error(error.stderr?.trim()||error.message);process.exitCode=1;}
