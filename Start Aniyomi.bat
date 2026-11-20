@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
set "PORT=8790"

rem already running? just reopen the window
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%PORT%/api/v1/health')|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 goto open

rem dex2jar can hard-crash the JVM, so the engine is supervised:
rem watchdog.ps1 restarts it whenever the port stops answering (single instance).
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%scripts\watchdog.ps1"

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%PORT%/api/v1/health')|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% neq 0 (
  set /a tries+=1
  if %tries% lss 60 goto wait
)

rem the manga tab is an embedded Suwayomi page; give it up to 40s to answer too
set /a mtries=0
:mwait
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:4567/api/v1/settings/about')|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 goto open
set /a mtries+=1
if %mtries% lss 40 (
  timeout /t 1 /nobreak >nul
  goto mwait
)

:open
set "BRAVE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "%BRAVE%" (
  start "" "%BRAVE%" --app=http://127.0.0.1:%PORT%/ --window-size=1500,950 --user-data-dir="%ROOT%window-profile"
) else (
  start "" "http://127.0.0.1:%PORT%/"
)
