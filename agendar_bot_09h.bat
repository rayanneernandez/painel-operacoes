@echo off
:: Registra o Bot DisplayForce Panvel no Agendador de Tarefas do Windows
:: Execute COMO ADMINISTRADOR uma única vez para ativar o agendamento

set TAREFA=BotDisplayforce_Panvel_09h
set BAT=%~dp0executar_bot_campanhas.bat

echo Registrando tarefa: %TAREFA%
echo Arquivo: %BAT%

schtasks /Delete /TN "%TAREFA%" /F >nul 2>&1

schtasks /Create /TN "%TAREFA%" /TR "cmd /c \"%BAT%\"" /SC DAILY /ST 09:00 /F

if %ERRORLEVEL% == 0 (
    echo.
    echo Tarefa agendada com sucesso!
    echo    Nome   : %TAREFA%
    echo    Horario: todos os dias as 09:00
    echo    Filtro : apenas rede Panvel
    echo.
    schtasks /Query /TN "%TAREFA%" /FO LIST
) else (
    echo.
    echo ERRO ao registrar — execute este arquivo como Administrador.
)

pause
