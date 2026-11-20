# company-chat-tinode-v1: the company chat on this server, from the two official archives in C:\Windows\Temp:
#   postgresql-17.12-2-windows-x64-binaries.zip (EnterpriseDB)    tinode-postgres.windows-amd64.zip (Tinode v0.25.3)
# 1. PostgreSQL in D:\dsh\pgsql, data in D:\dsh\pgdata (SYSTEM, Administrators, NETWORK SERVICE only), listening on
#    127.0.0.1 only, as the Windows service TDH-PostgreSQL; a database and role "tinode".
# 2. Tinode in D:\dsh\tinode (SYSTEM and Administrators only: its config holds the database password and its token
#    key), uploads in D:\dsh\tinode-uploads, set up by tinode-setup.py, tables by init-db, the task Autostart-Tinode.
# 3. Its routes in Caddy (chat.caddy in runtime\caddy\ext), reloaded without a restart.
# Passwords are made here and kept in D:\dsh\runtime (admins only); none is printed. Each step is skipped when it is
# done already, so a second run changes nothing. Prints CHAT_INSTALL_OK=1.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([string]$Root = 'D:\dsh', [string]$Repo = 'C:\TDHarness', [string]$Python = 'C:\Program Files\Python312\python.exe')
$ErrorActionPreference = 'Stop'
$Rt = Join-Path $Root 'runtime'
$Pg = Join-Path $Root 'pgsql'
$Data = Join-Path $Root 'pgdata'
$Tin = Join-Path $Root 'tinode'
$Up = Join-Path $Root 'tinode-uploads'
$PgZip = 'C:\Windows\Temp\postgresql-17.12-2-windows-x64-binaries.zip'
$TinZip = 'C:\Windows\Temp\tinode-postgres.windows-amd64.zip'
$Chat = Join-Path $Repo 'server\chat'

function Secret([string]$name) {
  $f = Join-Path $Rt $name
  if (-not (Test-Path -LiteralPath $f)) {
    $b = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    [IO.File]::WriteAllText($f, ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', ''))
  }
  return ([IO.File]::ReadAllText($f)).Trim()
}
function Lock([string]$dir, [string[]]$more) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $g = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F') + $more
  & icacls.exe $dir /inheritance:r /grant:r @g | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('icacls-failed ' + $dir) }
}
function Psql([string]$sql, [hashtable]$vars) {
  $args2 = @('-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA')
  foreach ($k in $vars.Keys) { $args2 += @('-v', ($k + '=' + $vars[$k])) }
  $out = $sql | & (Join-Path $Pg 'bin\psql.exe') @args2 -f -
  if ($LASTEXITCODE -ne 0) { throw 'psql-failed' }
  return $out
}

# ---- 1. PostgreSQL ----
if (-not (Test-Path -LiteralPath (Join-Path $Pg 'bin\postgres.exe'))) {
  if (-not (Test-Path -LiteralPath $PgZip)) { throw 'postgres-zip-missing' }
  Expand-Archive -LiteralPath $PgZip -DestinationPath $Root -Force
}
$su = Secret 'pg-superuser.secret'
$dbpw = Secret 'tinode-db.secret'
if (-not (Test-Path -LiteralPath (Join-Path $Data 'PG_VERSION'))) {
  Lock $Data @('*S-1-5-20:(OI)(CI)M')
  $pwf = Join-Path $Rt ('pg-init-' + [guid]::NewGuid().ToString('N') + '.tmp')
  [IO.File]::WriteAllText($pwf, $su)
  try {
    & (Join-Path $Pg 'bin\initdb.exe') -D $Data -U postgres -A scram-sha-256 ('--pwfile=' + $pwf) -E UTF8 --no-locale | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'initdb-failed' }
  } finally { Remove-Item -LiteralPath $pwf -Force -ErrorAction SilentlyContinue }
  Add-Content -LiteralPath (Join-Path $Data 'postgresql.conf') -Value "`r`n# company-chat-tinode-v1`r`nlisten_addresses = '127.0.0.1'`r`nport = 5432`r`n"
  Write-Output 'PG_INITDB=1'
}
if (-not (Get-Service -Name 'TDH-PostgreSQL' -ErrorAction SilentlyContinue)) {
  & (Join-Path $Pg 'bin\pg_ctl.exe') register -N 'TDH-PostgreSQL' -D $Data -S auto -w | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'pg-register-failed' }
}
if ((Get-Service -Name 'TDH-PostgreSQL').Status -ne 'Running') { Start-Service -Name 'TDH-PostgreSQL' }
$env:PGPASSWORD = $su
try {
  for ($i = 0; $i -lt 30; $i++) {
    & (Join-Path $Pg 'bin\pg_isready.exe') -h 127.0.0.1 -p 5432 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep 1
  }
  if ((Psql "SELECT count(*) FROM pg_roles WHERE rolname = 'tinode';" @{}) -eq '0') {
    Psql "CREATE ROLE tinode LOGIN PASSWORD :'pw';" @{ pw = $dbpw } | Out-Null
    Write-Output 'PG_ROLE=created'
  }
  if ((Psql "SELECT count(*) FROM pg_database WHERE datname = 'tinode';" @{}) -eq '0') {
    Psql "CREATE DATABASE tinode OWNER tinode ENCODING 'UTF8' TEMPLATE template0;" @{} | Out-Null
    Write-Output 'PG_DB=created'
  }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
Write-Output ('PG_SERVICE=' + (Get-Service -Name 'TDH-PostgreSQL').Status)

# ---- 2. Tinode ----
if (-not (Test-Path -LiteralPath (Join-Path $Tin 'tinode.exe'))) {
  if (-not (Test-Path -LiteralPath $TinZip)) { throw 'tinode-zip-missing' }
  Lock $Tin @()
  Expand-Archive -LiteralPath $TinZip -DestinationPath $Tin -Force
}
Lock $Up @()
& $Python (Join-Path $Chat 'tinode-setup.py') --tinode $Tin --runtime $Rt --uploads $Up --vendor (Join-Path $Chat 'vendor')
if ($LASTEXITCODE -ne 0) { throw 'tinode-setup-failed' }
Push-Location $Tin
try {
  $initOut = & (Join-Path $Tin 'init-db.exe') -config (Join-Path $Tin 'tinode.conf') 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('init-db-failed ' + (($initOut | Select-Object -Last 3) -join ' | ')) }
  Write-Output ('INIT_DB=' + (($initOut | Select-Object -Last 1) -join ''))
} finally { Pop-Location }
$a = New-ScheduledTaskAction -Execute (Join-Path $Tin 'tinode.exe') -Argument ('-config "' + (Join-Path $Tin 'tinode.conf') + '" -static_data "' + (Join-Path $Tin 'static') + '"') -WorkingDirectory $Tin
$tr = New-ScheduledTaskTrigger -AtStartup
$tr.Delay = 'PT30S'
$pr = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Autostart-Tinode' -Action $a -Trigger $tr -Principal $pr -Settings $st -Force | Out-Null
if ((Get-ScheduledTask -TaskName 'Autostart-Tinode').State -ne 'Running') { Start-ScheduledTask -TaskName 'Autostart-Tinode' }
for ($i = 0; $i -lt 30; $i++) {
  if (Get-NetTCPConnection -LocalPort 6060 -State Listen -ErrorAction SilentlyContinue) { break }
  Start-Sleep 1
}
if (-not (Get-NetTCPConnection -LocalPort 6060 -State Listen -ErrorAction SilentlyContinue)) { throw 'tinode-not-listening' }
Write-Output 'TINODE=listening 127.0.0.1:6060'

# ---- 3. Caddy ----
$ext = Join-Path $Rt 'caddy\ext\chat.caddy'
Copy-Item -LiteralPath (Join-Path $Chat 'chat.caddy') -Destination $ext -Force
& (Join-Path $Rt 'caddy\caddy.exe') reload --config (Join-Path $Rt 'caddy\Caddyfile') --adapter caddyfile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'caddy-reload-failed' }
Write-Output 'CADDY=reloaded'
Write-Output 'CHAT_INSTALL_OK=1'
