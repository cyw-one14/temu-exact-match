param([switch]$OpenSetup)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeExecutable = $nodeCommand.Source }
else {
  $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundledNode) { $nodeExecutable = $bundledNode }
  else { throw '找不到 Node.js 22+。请从 https://nodejs.org 安装后重试。' }
}
$runtimeRecord = Join-Path $projectRoot '.local-runtime.json'
$expectedVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$serviceReady = $false
$serviceHealth = $null
try { $serviceHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:43187/health' -TimeoutSec 2; $serviceReady = ($serviceHealth.version -eq $expectedVersion -and $serviceHealth.extensionId) } catch { }
if ($serviceHealth -and -not $serviceReady) {
  if (-not (Test-Path -LiteralPath $runtimeRecord)) { throw '已有其他版本服务占用端口。请先关闭该服务，再启动本项目。' }
  & (Join-Path $PSScriptRoot 'stop-service.ps1')
}
if (-not $serviceReady) {
  & $nodeExecutable (Join-Path $projectRoot 'scripts\init-key.mjs')
  if ($LASTEXITCODE -ne 0) { throw '插件初始化失败' }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\@huggingface\transformers'))) { throw '尚未安装运行依赖，请按 README 中的首次安装步骤操作。' }
  $cacheDirectory = Join-Path $projectRoot '.cache'
  New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
  $publicModelUri = [uri]'https://huggingface.co/'
  $proxyUri = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($publicModelUri)
  if ($proxyUri.Host -ne $publicModelUri.Host) {
    $env:HTTPS_PROXY = $proxyUri.AbsoluteUri
    $env:HTTP_PROXY = $proxyUri.AbsoluteUri
    $env:NO_PROXY = 'localhost,127.0.0.1'
    $env:NODE_USE_ENV_PROXY = '1'
  }
  $serverFile = Join-Path $projectRoot 'server\index.mjs'
  $serviceProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @(('"' + $serverFile + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $cacheDirectory 'service.log') -RedirectStandardError (Join-Path $cacheDirectory 'service-error.log') -PassThru
  @{ processId=$serviceProcess.Id; serverPath=$serverFile; projectRoot=$projectRoot } | ConvertTo-Json | Set-Content -LiteralPath $runtimeRecord -Encoding UTF8
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    try { $serviceHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:43187/health' -TimeoutSec 1; $serviceReady=($serviceHealth.version -eq $expectedVersion -and $serviceHealth.extensionId); if ($serviceReady) { break } } catch { }
    Start-Sleep -Milliseconds 300
  }
  if (-not $serviceReady) { throw '识别服务未启动，请查看 .cache\service-error.log。' }
}
Write-Output 'TEMU 本机识别服务已启动：http://127.0.0.1:43187/setup'
if ($OpenSetup) { Start-Process 'http://127.0.0.1:43187/setup' }
