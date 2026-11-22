# company-mail-v1: the mailboxes on this server (server\mail_api.py inside the people service).
# 1. The agent's skill company-mail in company\_skills (desks take it when TDH starts).
# 2. Its route in Caddy (mail.caddy in runtime\caddy\ext), reloaded (or restarted when Caddy has no admin endpoint).
# 3. The people service restarted, so it loads mail_api.py; waits for 4181 again.
# Run after server\mail_api.py, server\people-api.py and server\mail\ are in place under $Repo. A second run changes
# nothing. Prints MAIL_INSTALL_OK=1. Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
param([string]$Root = 'D:\dsh', [string]$Repo = 'C:\TDHarness')
$ErrorActionPreference = 'Stop'
$Rt = Join-Path $Root 'runtime'
$Mail = Join-Path $Repo 'server\mail'

function Native([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argv 2>&1 | ForEach-Object { [string]$_ } } finally { $ErrorActionPreference = $old }
  return @{ code = $LASTEXITCODE; out = $out }
}

foreach ($f in @((Join-Path $Repo 'server\mail_api.py'), (Join-Path $Mail 'mail.caddy'), (Join-Path $Mail 'skills\company-mail\SKILL.md'))) {
  if (-not (Test-Path -LiteralPath $f)) { throw ('missing ' + $f) }
}

# ---- 1. The skill ----
$skills = Join-Path $Root 'company\_skills'
if (Test-Path -LiteralPath $skills) {
  Copy-Item -LiteralPath (Join-Path $Mail 'skills\company-mail') -Destination $skills -Recurse -Force
  Write-Output 'SKILL=company-mail'
}

# ---- 2. Caddy ----
$ext = Join-Path $Rt 'caddy\ext\mail.caddy'
$same = (Test-Path -LiteralPath $ext) -and ((Get-FileHash -LiteralPath $ext).Hash -eq (Get-FileHash -LiteralPath (Join-Path $Mail 'mail.caddy')).Hash)
if ($same) {
  Write-Output 'CADDY=unchanged'
} else {
  Copy-Item -LiteralPath (Join-Path $Mail 'mail.caddy') -Destination $ext -Force
  $caddy = Join-Path $Rt 'caddy\caddy.exe'
  $cfile = Join-Path $Rt 'caddy\Caddyfile'
  $r = Native $caddy @('validate', '--config', $cfile, '--adapter', 'caddyfile')
  if ($r.code -ne 0) {
    Remove-Item -LiteralPath $ext -Force
    throw ('caddy-validate-failed ' + (($r.out | Select-Object -Last 3) -join ' | '))
  }
  if (Select-String -LiteralPath $cfile -Pattern '^\s*admin\s+off' -Quiet) {
    # No admin endpoint: restart it once no model reply is streaming through it (3 minutes at most).
    $pids = @(Get-Process -Name caddy -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    for ($i = 0; $i -lt 90; $i++) {
      $busy = @(Get-NetTCPConnection -RemotePort 8450 -State Established -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess }).Count
      if ($busy -eq 0) { break }
      Start-Sleep 2
    }
    Write-Output ('CADDY_WAITED_S=' + ($i * 2))
    Stop-ScheduledTask -TaskName 'Autostart-Caddy-8443'
    Start-Sleep 1
    Start-ScheduledTask -TaskName 'Autostart-Caddy-8443'
    for ($i = 0; $i -lt 30; $i++) {
      if (Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue) { break }
      Start-Sleep 1
    }
    if (-not (Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue)) { throw 'caddy-not-listening' }
    Write-Output 'CADDY=restarted'
  } else {
    $r = Native $caddy @('reload', '--config', $cfile, '--adapter', 'caddyfile')
    if ($r.code -ne 0) { throw ('caddy-reload-failed ' + (($r.out | Select-Object -Last 3) -join ' | ')) }
    Write-Output 'CADDY=reloaded'
  }
}

# ---- 3. The people service ----
Stop-ScheduledTask -TaskName 'Autostart-PeopleApi'
Get-CimInstance Win32_Process -Filter "name like 'python%'" | Where-Object { $_.CommandLine -match 'people-api\.py' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep 1
Start-ScheduledTask -TaskName 'Autostart-PeopleApi'
for ($i = 0; $i -lt 40; $i++) {
  if (Get-NetTCPConnection -LocalPort 4181 -State Listen -ErrorAction SilentlyContinue) { break }
  Start-Sleep 1
}
if (-not (Get-NetTCPConnection -LocalPort 4181 -State Listen -ErrorAction SilentlyContinue)) { throw 'people-api-not-listening' }
Write-Output ('PEOPLE_API=restarted ' + $i + 's')
Write-Output 'MAIL_INSTALL_OK=1'
