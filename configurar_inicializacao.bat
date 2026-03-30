@echo off
:: ============================================================
::  Configura o Bot DisplayForce para iniciar automaticamente
::  com o Windows (via Agendador de Tarefas)
::  Execute UMA VEZ como Administrador
:: ============================================================

echo.
echo  ================================================
echo   Configurando inicio automatico do Bot
echo  ================================================
echo.

:: Caminho absoluto do iniciar_bot.bat (mesma pasta deste script)
set "BOT_PATH=%~dp0iniciar_bot.bat"
set "TASK_NAME=BotDisplayForce_PainelOperacoes"

:: Remove tarefa anterior se existir
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Cria a tarefa para iniciar no login do usuario atual
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd.exe /c start \"Bot DisplayForce\" \"%BOT_PATH%\"" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /delay 0001:00 ^
  /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo  [OK] Tarefa criada com sucesso!
    echo.
    echo  O bot vai iniciar automaticamente toda vez que
    echo  o Windows ligar, 1 minuto apos o login.
    echo.
    echo  Para verificar: abra o Agendador de Tarefas
    echo  e procure por "%TASK_NAME%"
    echo.
    echo  Para remover o inicio automatico, execute:
    echo  schtasks /delete /tn "%TASK_NAME%" /f
    echo.
) else (
    echo.
    echo  [ERRO] Falha ao criar tarefa.
    echo  Execute este arquivo como Administrador:
    echo  clique direito ^> "Executar como administrador"
    echo.
)

pause
