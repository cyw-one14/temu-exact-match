@echo off
chcp 65001 >nul
setlocal
set "TEMU_MATCH_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined TEMU_MATCH_NODE set "TEMU_MATCH_NODE=%%N"
if not defined TEMU_MATCH_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "TEMU_MATCH_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined TEMU_MATCH_NODE goto missing_node
"%TEMU_MATCH_NODE%" "%~dp0scripts\service-autostart.mjs" disable
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo 找不到 Node.js。请安装 Node.js 22 或更新版本后重试。
:failed
echo.
echo 开机自启设置失败，请保留上方错误提示。
if not "%TEMU_MATCH_NO_PAUSE%"=="1" pause
exit /b 1
