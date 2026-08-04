@echo off
setlocal
cd /d "%~dp0"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/index.html"
set "PYTHON_CMD="

where py >nul 2>nul && set "PYTHON_CMD=py"

if not defined PYTHON_CMD (
  where python >nul 2>nul && set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  start "" msedge "%~dp0index.html"
  if errorlevel 1 start "" "%~dp0index.html"
  goto :end
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if %errorlevel%==0 (
  echo Det kjorer allerede en lokal server paa %URL%.
  start "" msedge "%URL%"
  if errorlevel 1 start "" "%URL%"
  goto :end
)

echo GeoAI starter lokal webserver i dette vinduet.
echo La vinduet staa aapent. Trykk Ctrl+C her for aa stoppe serveren.
start "" /min "%ComSpec%" /c "timeout /t 2 /nobreak >nul && start msedge %URL%"
%PYTHON_CMD% -m http.server %PORT% --bind 127.0.0.1

:end
endlocal
