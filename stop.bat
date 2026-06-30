@echo off
pushd "%~dp0"

set PID=

if exist server.pid (
  for /f %%a in ('powershell -Command "& { try { (Get-Content server.pid -Raw).Trim() } catch {} }"') do set PID=%%a
)

if "%PID%"=="" (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":3000.*LISTENING"') do set PID=%%a
)

if not "%PID%"=="" (
  taskkill /f /pid %PID% >nul 2>&1
  if errorlevel 1 (
    echo Stop FAILED for PID %PID%, try manual close.
  ) else (
    if exist server.pid del server.pid
    echo 311 Building B server stopped.
  )
) else (
  echo No running 311 Building B server found.
)
pause
