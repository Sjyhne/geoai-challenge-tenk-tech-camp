@echo off
setlocal
cd /d "%~dp0"
echo Girl Tech Fest - Lag ditt eget kart
echo Apne http://127.0.0.1:8765/ i nettleseren.
echo La vinduet sta apent. Trykk Ctrl+C for a stoppe.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server 8765 --bind 127.0.0.1
) else (
  python -m http.server 8765 --bind 127.0.0.1
)
pause
endlocal
