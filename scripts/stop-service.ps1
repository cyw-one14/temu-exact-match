$ErrorActionPreference='Stop'
$projectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRecord=Join-Path $projectRoot '.local-runtime.json'
if(-not(Test-Path -LiteralPath $runtimeRecord)){Write-Output '没有本项目启动的识别服务。';exit}
$runtimeData=Get-Content -LiteralPath $runtimeRecord -Raw | ConvertFrom-Json
$expectedServer=Join-Path $projectRoot 'server\index.mjs'
if($runtimeData.serverPath -ne $expectedServer){throw '服务记录不匹配，未停止任何进程。'}
$serviceProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$runtimeData.processId)
if($serviceProcess -and $serviceProcess.Name -eq 'node.exe' -and $serviceProcess.CommandLine.Contains($expectedServer)) { Stop-Process -Id $serviceProcess.ProcessId; Write-Output '本项目的识别服务已停止。' }
else { Write-Output '服务进程已经停止。' }
Remove-Item -LiteralPath $runtimeRecord
