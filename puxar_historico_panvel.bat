@echo off
:: ============================================================
:: Puxa dados históricos da Panvel — Janeiro a Julho 2026
:: Roda o bot 7 vezes, uma por mês, acumulando no banco
:: Cada execução pode demorar ~5 minutos (aguarda email com ZIP)
:: ============================================================
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo ============================================
echo  IMPORTACAO HISTORICA PANVEL — Jan a Jul
echo  %date% %time%
echo ============================================
echo.

echo [1/7] Janeiro (mes-anterior 6)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 6
echo.

echo [2/7] Fevereiro (mes-anterior 5)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 5
echo.

echo [3/7] Marco (mes-anterior 4)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 4
echo.

echo [4/7] Abril (mes-anterior 3)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 3
echo.

echo [5/7] Maio (mes-anterior 2)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 2
echo.

echo [6/7] Junho (mes-anterior 1)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 1
echo.

echo [7/7] Julho — mes atual (mes-anterior 0)...
python bot_displayforce.py --agora --clientes Panvel --mes-anterior 0
echo.

echo ============================================
echo  CONCLUIDO! Verifique o grafico no dashboard
echo  %date% %time%
echo ============================================
pause
