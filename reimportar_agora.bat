@echo off
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
echo Reimportando CSVs com Genero, Idade e Tempo Total...
echo.
python reimportar_views_existentes.py
echo.
pause
