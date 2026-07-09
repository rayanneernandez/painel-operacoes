@echo off
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
echo ==============================
echo  Puxando JUNHO (1 mes atras)
echo  %date% %time%
echo ==============================
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 1 --force-reprocess
echo.
echo Concluido! %date% %time%
pause
