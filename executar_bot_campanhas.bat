@echo off
:: Executado pelo Agendador de Tarefas do Windows às 09:00
:: Roda o bot UMA VEZ para a rede PANVEL e encerra — sem loop, sem janela parada aberta
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
python bot_displayforce.py --agora --clientes Panvel
