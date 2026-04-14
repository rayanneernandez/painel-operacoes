param(
  [switch]$Once = $true
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFiles = @(
  (Join-Path $repoRoot '.env.production.local'),
  (Join-Path $repoRoot '.env')
)

foreach ($envFile in $envFiles) {
  if (-not (Test-Path $envFile)) { continue }
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim()
      if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

$logsDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$logFile = Join-Path $logsDir 'displayforce-campaign-bot.log'
$runId = (Get-Date).ToString('yyyyMMdd_HHmmss_fff')
$stdoutFile = Join-Path $logsDir "displayforce-campaign-bot.$runId.stdout.log"
$stderrFile = Join-Path $logsDir "displayforce-campaign-bot.$runId.stderr.log"

$pythonCandidates = @(
  (Join-Path $repoRoot '.venv\Scripts\python.exe'),
  (Join-Path $repoRoot 'venv\Scripts\python.exe'),
  'python'
)

$pythonExe = $pythonCandidates | Where-Object { $_ -eq 'python' -or (Test-Path $_) } | Select-Object -First 1
if (-not $pythonExe) {
  throw 'Python não encontrado para executar o bot da DisplayForce.'
}

$args = @('bot_displayforce.py')
if ($Once) {
  $args += '--once'
}

Push-Location $repoRoot
try {
  "[$((Get-Date).ToString('s'))] Iniciando bot de campanhas DisplayForce: $($args -join ' ')" | Out-File -FilePath $logFile -Append -Encoding utf8

  $proc = Start-Process `
    -FilePath $pythonExe `
    -ArgumentList $args `
    -WorkingDirectory $repoRoot `
    -NoNewWindow `
    -Wait `
    -PassThru `
    -RedirectStandardOutput $stdoutFile `
    -RedirectStandardError $stderrFile

  if (Test-Path $stdoutFile) {
    Get-Content $stdoutFile | Tee-Object -FilePath $logFile -Append
  }

  if (Test-Path $stderrFile) {
    $stderrText = Get-Content $stderrFile
    if ($stderrText) {
      $stderrText | Tee-Object -FilePath $logFile -Append
    }
  }

  if ($proc.ExitCode -ne 0) {
    throw "Bot DisplayForce falhou com exit code $($proc.ExitCode)"
  }

  "[$((Get-Date).ToString('s'))] Bot finalizado com sucesso" | Out-File -FilePath $logFile -Append -Encoding utf8
} finally {
  Pop-Location
}
