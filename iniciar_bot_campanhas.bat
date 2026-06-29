@echo off
:: ============================================================
::  Bot Campanhas DisplayForce
::  Roda UMA VEZ por dia às 09:00 (horário de Brasília)
::  Mantém o processo ativo com reinício automático em caso de erro
:: ============================================================
title Bot Campanhas - Painel Operacoes

cd /d "%~dp0"
echo.
echo  ================================================
echo   Bot Campanhas DisplayForce
echo   Execucao diaria automatica as 09:00
echo   NAO FECHE esta janela
echo  ================================================
echo.

:LOOP
echo [%date% %time%] Iniciando bot...
python bot_displayforce.py

echo.
echo [%date% %time%] Bot encerrou. Reiniciando em 60 segundos...
echo  (Pressione Ctrl+C para parar definitivamente)
echo.
timeout /t 60 /nobreak
goto LOOP
