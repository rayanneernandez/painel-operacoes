@echo off
:: Executado pelo Agendador de Tarefas do Windows às 09:00
:: Roda o bot UMA VEZ e encerra — sem loop, sem janela parada aberta
cd /d "%~dp0"
python bot_displayforce.py --agora
