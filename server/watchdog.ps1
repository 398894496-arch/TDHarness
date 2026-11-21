# company-watchdog-v1: start a site service again when it has died.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
#
# Task TDH-Watchdog (SYSTEM, every 2 minutes; scripts\setup-server.ps1 registers it) runs:
#   powershell -NoProfile -ExecutionPolicy Bypass -File server\watchdog.ps1 [-Root D:\dsh] [-Config file] [-DryRun]
#
# Each service is its own scheduled task that starts once at boot (Autostart-Gateway ...). Task
# Scheduler's "restart on failure" only covers a task that fails to start, not a process that exits
# later, so a gateway that died on an error stayed down (2026-11-20: GPT 502 for everyone).
# Here: a service whose port is closed at two checks in a row is started again by its own task
# (one still Running but not listening is ended first). A task that is missing or disabled is left
# alone. While runtime\maintenance.flag is younger than an hour (setup-server writes it while it
# swaps the services) nothing is started. runtime\watchdog.json {"checks":[{"task":..,"port":..}]}
# replaces the list below. Log: logs\watchdog.log, one line per closed port and per start.
param(
  [string]$Root = 'D:\dsh',
  [string]$Config = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'
$runtime = Join-Path $Root 'runtime'
$logFile = Join-Path $Root 'logs\watchdog.log'
$stateFile = Join-Path $runtime 'watchdog-state.json'
$checks = @(
  @{ task = 'Autostart-Gateway'; port = 8450 },
  @{ task = 'Autostart-KnowledgeSearch'; port = 4182 },
  @{ task = 'Autostart-PeopleApi'; port = 4181 },
  @{ task = 'Autostart-Caddy-8443'; port = 8443 },
  @{ task = 'Autostart-Tinode'; port = 6060 },
  @{ task = 'TDH-CLIProxyAPI'; port = 8317 },
  @{ task = 'TDH-Mfg-Api'; port = 4190 }
)
if (-not $Config) { $Config = Join-Path $runtime 'watchdog.json' }
if (Test-Path -LiteralPath $Config) {
  try {
    $c = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json
    if ($c.checks) { $checks = @($c.checks | ForEach-Object { @{ task = [string]$_.task; port = [int]$_.port } }) }
  } catch { }
}

function Log([string]$m) {
  $line = (Get-Date -Format s) + ' ' + $m
  if ($DryRun) { Write-Output $line; return }
  try { Add-Content -LiteralPath $logFile -Value $line -Encoding ASCII } catch { }
}

$flag = Join-Path $runtime 'maintenance.flag'
if ((Test-Path -LiteralPath $flag) -and ((Get-Item -LiteralPath $flag).LastWriteTime -gt (Get-Date).AddHours(-1))) {
  if ($DryRun) { Log 'maintenance.flag is fresh: nothing started' }
  exit 0
}

$state = @{}
if (Test-Path -LiteralPath $stateFile) {
  try { (Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = [int]$_.Value } } catch { }
}
$listening = @{}
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $listening[[int]$_.LocalPort] = $true }

foreach ($c in $checks) {
  $t = Get-ScheduledTask -TaskName $c.task -ErrorAction SilentlyContinue
  if (-not $t -or [string]$t.State -eq 'Disabled') { continue }
  if ($listening[[int]$c.port]) {
    $state[$c.task] = 0
    if ($DryRun) { Log ($c.task + ' listening on ' + $c.port) }
    continue
  }
  $miss = [int]$state[$c.task] + 1
  $state[$c.task] = $miss
  if ($miss -lt 2) { Log ($c.task + ' port ' + $c.port + ' closed (first check, task ' + $t.State + ')'); continue }
  if ($DryRun) { Log ($c.task + ' would be started (task ' + $t.State + ')'); continue }
  $prev = [string]$t.State
  if ($prev -eq 'Running') { & schtasks.exe /End /TN $c.task 2>&1 | Out-Null; Start-Sleep -Seconds 2 }
  & schtasks.exe /Run /TN $c.task 2>&1 | Out-Null
  Log ($c.task + ' port ' + $c.port + ' closed at two checks (task was ' + $prev + '): started again')
  $state[$c.task] = 0
}
if (-not $DryRun) {
  try { [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Compress)) } catch { }
}
