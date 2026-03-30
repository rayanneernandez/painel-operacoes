@echo off
:: ============================================================
::  Configura o Bot DisplayForce para iniciar automaticamente
::  Metodo: pasta Startup do Windows (nao precisa de admin)
:: ============================================================

echo.
echo  ================================================
echo   Configurando inicio automatico do Bot
echo  ================================================
echo.

:: Caminho do iniciar_bot.bat
set "BOT_PATH=%~dp0iniciar_bot.bat"

:: Pasta de inicializacao do Windows para o usuario atual
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

:: Nome do atalho
set "ATALHO=%STARTUP%\BotDisplayForce.bat"

:: Copia o bat para a pasta de startup
copy /Y "%BOT_PATH%" "%ATALHO%" >nul

if %ERRORLEVEL% EQU 0 (
    echo  [OK] Bot configurado para iniciar automaticamente!
    echo.
    echo  O bot vai iniciar sozinho toda vez que
    echo  o Windows ligar.
    echo.
    echo  Arquivo copiado para:
    echo  %ATALHO%
    echo.
    echo  Para REMOVER o inicio automatico, delete o arquivo:
    echo  BotDisplayForce.bat  dentro da pasta:
    echo  %STARTUP%
    echo.
    echo  Iniciando o bot agora pela primeira vez...
    echo.
    start "Bot DisplayForce" "%BOT_PATH%"
) else (
    echo  [ERRO] Nao foi possivel copiar o arquivo.
    echo  Tente manualmente: copie iniciar_bot.bat para:
    echo  %STARTUP%
    echo.
)

pause
