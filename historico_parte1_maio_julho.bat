@echo off
:: ============================================================
:: PARTE 1 — Maio, Junho e Julho 2026
:: Rode HOJE
:: ============================================================
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo ============================================
echo  HISTORICO PANVEL — Parte 1: Maio a Julho
echo  %date% %time%
echo ============================================
echo.

echo [1/3] Maio (mes-anterior 2)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 2
echo.

echo [2/3] Junho (mes-anterior 1)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 1
echo.

echo [3/3] Julho — mes atual (mes-anterior 0)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 0
echo.

echo ============================================
echo  PARTE 1 CONCLUIDA! Maio, Junho e Julho
echo  Amanha rode: historico_parte2_janeiro_abril.bat
echo  %date% %time%
echo ============================================
pause
