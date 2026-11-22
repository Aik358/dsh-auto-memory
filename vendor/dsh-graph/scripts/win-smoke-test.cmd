@echo off
rem dsh-graph Windows 快速验收脚本 —— 双击即可运行（结果窗口会停留）
rem 需要 Node.js >= 22；脚本本身不改动你真实的 DSH_HOME（默认用临时目录）。
chcp 65001 >nul
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node 命令。请先安装 Node.js ^(^>=22^)：https://nodejs.org/
  echo.
  pause
  exit /b 1
)
node "%~dp0win-smoke-test.mjs" %*
set "RC=%ERRORLEVEL%"
echo.
echo （退出码 %RC%：0=全部通过，1=有失败项）
pause
exit /b %RC%
