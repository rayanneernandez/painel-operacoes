@echo off
:: Execute como Administrador (botao direito -> Executar como administrador)

echo Removendo tarefa anterior (se existir)...
schtasks /delete /tn "GloballA-BotCampanhas-0900" /f 2>nul

echo Criando tarefa agendada...
schtasks /create ^
  /tn "GloballA-BotCampanhas-0900" ^
  /tr "\"C:\Users\GTIA003\Desktop\Acesso Rapido\Meus\painel-operacoes-main\painel-operacoes-main\executar_bot_campanhas.bat\"" ^
  /sc DAILY ^
  /st 09:00 ^
  /ru "%USERDOMAIN%\%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %ERRORLEVEL%==0 (
    echo.
    echo Tarefa criada com sucesso!
    echo Roda todos os dias as 09:00
) else (
    echo.
    echo ERRO ao criar tarefa. Tente executar como Administrador.
)

echo.
pause
