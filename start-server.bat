@echo off
cd /d %~dp0
echo.
echo  Knalkarts draait! Open op je telefoon (zelfde wifi):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo    http://%%b:8093
echo.
echo  Sluit dit venster om te stoppen.
echo.
py -m http.server 8093
