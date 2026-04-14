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

:: Cria um wrapper na pasta Startup que chama o bat pelo caminho COMPLETO.
:: (Nao copiar diretamente — senao %~dp0 aponta para Startup e o bot nao acha os arquivos)
(
    echo @echo off
    echo call "%BOT_PATH%"
) > "%ATALHO%"

if %ERRORLEVEL% EQU 0 (
    echo  [OK] Bot configurado para iniciar automaticamente!
    echo.
    echo  O bot vai iniciar sozinho toda vez que
    echo  o Windows ligar.
    echo.
    echo  Wrapper criado em:
    echo  %ATALHO%
    echo.
    echo  (O wrapper chama: %BOT_PATH%^)
    echo.
    echo  Para REMOVER o inicio automatico, delete o arquivo:
    echo  BotDisplayForce.bat  na pasta:
    echo  %STARTUP%
    echo.
    echo  Iniciando o bot agora pela primeira vez...
    echo.
    start "Bot DisplayForce" "%BOT_PATH%"
) else (
    echo  [ERRO] Nao foi possivel criar o wrapper.
    echo  Tente manualmente: crie um arquivo BotDisplayForce.bat em:
    echo  %STARTUP%
    echo  Com o conteudo:
    echo    @echo off
    echo    call "%BOT_PATH%"
    echo.
)

pause
