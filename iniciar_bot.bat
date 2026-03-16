@echo off
:: ============================================================
::  Bot DisplayForce — Inicialização com Reinício Automático
::  Mantém o bot sempre online, reiniciando se cair
:: ============================================================
title Bot DisplayForce - Painel Operacoes

cd /d "%~dp0"
echo.
echo  ================================================
echo   Bot DisplayForce ^| Painel de Operacoes
echo   Iniciando... (nao feche esta janela)
echo  ================================================
echo.

:LOOP
echo [%date% %time%] Iniciando bot...
python bot_displayforce.py

:: Se o bot parar por qualquer motivo, aguarda 30s e reinicia
echo.
echo [%date% %time%] Bot parou. Reiniciando em 30 segundos...
echo  (Pressione Ctrl+C agora se quiser parar definitivamente)
echo.
timeout /t 30 /nobreak
goto LOOP
