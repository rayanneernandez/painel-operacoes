param(
  [switch]$Once,
  [int]$IntervalMinutes = 60
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
$nodeCandidates = @(
  (Join-Path $repoRoot 'node_modules\.bin\node.cmd'),
  'node'
)

$nodeExe = $nodeCandidates | Where-Object { $_ -eq 'node' -or (Test-Path $_) } | Select-Object -First 1
if (-not $nodeExe) {
  throw 'Node nao encontrado para executar o sincronizador da Display Force.'
}

function Invoke-CampaignSync {
  $runId = (Get-Date).ToString('yyyyMMdd_HHmmss_fff')
  $stdoutFile = Join-Path $logsDir "displayforce-campaign-bot.$runId.stdout.log"
  $stderrFile = Join-Path $logsDir "displayforce-campaign-bot.$runId.stderr.log"
  $args = @('scripts/sync-displayforce-campaigns.mjs', '--days=1')

  "[$((Get-Date).ToString('s'))] Iniciando sync de engajamento Display Force: node $($args -join ' ')" | Out-File -FilePath $logFile -Append -Encoding utf8

  $proc = Start-Process `
    -FilePath $nodeExe `
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
    throw "Sync Display Force falhou com exit code $($proc.ExitCode)"
  }

  "[$((Get-Date).ToString('s'))] Sync finalizado com sucesso" | Out-File -FilePath $logFile -Append -Encoding utf8
}

Push-Location $repoRoot
try {
  do {
    Invoke-CampaignSync
    if ($Once) { break }
    Start-Sleep -Seconds ([Math]::Max(1, $IntervalMinutes) * 60)
  } while ($true)
} finally {
  Pop-Location
}
