param(
  [ValidateSet('today', 'recent')]
  [string]$Mode = 'today'
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

$logFile = Join-Path $logsDir 'dashboard-sync.log'
$now = Get-Date
$today = $now.ToString('yyyy-MM-dd')
$start = if ($Mode -eq 'recent') { $now.AddDays(-1).ToString('yyyy-MM-dd') } else { $today }
$end = $today

Push-Location $repoRoot
try {
  "[$((Get-Date).ToString('s'))] Iniciando sync ($Mode) de $start ate $end" | Out-File -FilePath $logFile -Append -Encoding utf8
  $runId = (Get-Date).ToString('yyyyMMdd_HHmmss_fff')
  $stdoutFile = Join-Path $logsDir "dashboard-sync.$runId.stdout.log"
  $stderrFile = Join-Path $logsDir "dashboard-sync.$runId.stderr.log"

  $proc = Start-Process `
    -FilePath 'C:\Program Files\nodejs\node.exe' `
    -ArgumentList @('scripts/backfill-displayforce-range.mjs', "--start=$start", "--end=$end", '--clients=panvel,assai') `
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
    throw "Sync falhou com exit code $($proc.ExitCode)"
  }

  "[$((Get-Date).ToString('s'))] Sync finalizado" | Out-File -FilePath $logFile -Append -Encoding utf8
} finally {
  Pop-Location
}
