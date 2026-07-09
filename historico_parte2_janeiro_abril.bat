@echo off
:: ============================================================
:: PARTE 2 — Janeiro, Fevereiro, Marco e Abril 2026
:: Rode AMANHA
:: ============================================================
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo ============================================
echo  HISTORICO PANVEL — Parte 2: Janeiro a Abril
echo  %date% %time%
echo ============================================
echo.

echo [1/4] Janeiro (mes-anterior 6)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 6
echo.

echo [2/4] Fevereiro (mes-anterior 5)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 5
echo.

echo [3/4] Marco (mes-anterior 4)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 4
echo.

echo [4/4] Abril (mes-anterior 3)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 3
echo.

echo ============================================
echo  PARTE 2 CONCLUIDA! Janeiro a Abril
echo  Todos os dados de Jan a Jul estao no dashboard!
echo  %date% %time%
echo ============================================
pause
