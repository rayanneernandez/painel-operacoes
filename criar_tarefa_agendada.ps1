# Executar como Administrador!
# Clique com o botao direito no arquivo -> "Executar com o PowerShell"

$batPath = 'C:\Users\GTIA003\Desktop\Acesso Rapido\Meus\painel-operacoes-main\painel-operacoes-main\executar_bot_campanhas.bat'
$taskName = "GloballA-BotCampanhas-0900"

# Remove tarefa anterior se existir
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Cria a tarefa
$action   = New-ScheduledTaskAction -Execute $batPath
$trigger  = New-ScheduledTaskTrigger -Daily -At "09:00"
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
    -UserId "GTIA003" `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName    $taskName `
    -Action      $action `
    -Trigger     $trigger `
    -Settings    $settings `
    -Principal   $principal `
    -Description "Bot DisplayForce - puxa relatorios de campanha e atualiza Engajamento em Campanhas. Uma vez por dia as 09:00." `
    -Force

Write-Host ""
Write-Host "✅ Tarefa '$taskName' criada com sucesso!" -ForegroundColor Green
Write-Host "   Roda todos os dias as 09:00" -ForegroundColor Green
Write-Host ""
pause
