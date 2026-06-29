@echo off
:: Bat de DIAGNOSTICO — roda o bot e salva saida completa + mantem janela aberta
cd /d "%~dp0"

echo ============================================ > debug_bot_output.txt
echo  DIAGNOSTICO BOT DISPLAYFORCE >> debug_bot_output.txt
echo  %date% %time% >> debug_bot_output.txt
echo ============================================ >> debug_bot_output.txt

echo ============================================
echo  DIAGNOSTICO BOT DISPLAYFORCE
echo  %date% %time%
echo ============================================
echo.

:: Testa se python esta disponivel
python --version >> debug_bot_output.txt 2>&1
python --version
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Python nao encontrado! >> debug_bot_output.txt
    echo ERRO: Python nao encontrado no PATH!
    pause
    exit /b 1
)

echo. >> debug_bot_output.txt
echo --- Verificando playwright --- >> debug_bot_output.txt

:: Verifica playwright e instala browser se necessario
python -c "from playwright.sync_api import sync_playwright; print('playwright OK')" >> debug_bot_output.txt 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Instalando playwright... >> debug_bot_output.txt
    echo Instalando playwright...
    pip install playwright >> debug_bot_output.txt 2>&1
    echo Instalando chromium... >> debug_bot_output.txt
    echo Instalando chromium...
    python -m playwright install chromium >> debug_bot_output.txt 2>&1
) else (
    echo playwright OK >> debug_bot_output.txt
    echo playwright OK
)

echo. >> debug_bot_output.txt
echo --- Verificando chromium --- >> debug_bot_output.txt
python -c "from playwright.sync_api import sync_playwright; pw=sync_playwright().start(); b=pw.chromium.launch(); b.close(); pw.stop(); print('chromium OK')" >> debug_bot_output.txt 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Chromium nao disponivel, instalando... >> debug_bot_output.txt
    echo Chromium nao disponivel, instalando...
    python -m playwright install chromium >> debug_bot_output.txt 2>&1
    echo Instalacao concluida >> debug_bot_output.txt
    echo Instalacao concluida!
)

echo. >> debug_bot_output.txt
echo --- RODANDO BOT --- >> debug_bot_output.txt
echo.
echo ============================================
echo  INICIANDO BOT...
echo ============================================
echo.

python bot_displayforce.py --agora >> debug_bot_output.txt 2>&1

echo.
echo ============================================
echo  Resultado salvo em: debug_bot_output.txt
echo  Verifique o arquivo para ver o erro
echo ============================================
echo.
echo Pressione qualquer tecla para fechar...
pause > nul
