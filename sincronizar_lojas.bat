@echo off
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
echo Sincronizando lojas/dispositivos (puxa a data de instalacao)...
echo.
python sync_lojas_agora.py
echo.
pause
