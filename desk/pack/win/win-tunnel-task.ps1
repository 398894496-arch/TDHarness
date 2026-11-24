# company-wg-desk-win-v1: keeps this PC's end of the company tunnel. Runs as SYSTEM from boot (task \TDHarness\TDHarness
# Tunnel, put in place by win-tunnel-install.ps1), from C:\ProgramData\TDHarness\tunnel where only admins may change it.
#
# Every 5 s:
#   - the tunnel service WireGuardTunnel$tdhdesk on the address the desk enrolled (enroll\peer.json; only an address in
#     10.66.0.0/24 is taken) with the hub from hub.json (written by the elevated install only). A new address or hub:
#     the service is put in again. Stopped: started.
# Every 15 s:
#   - where the company host name (hub.json "host", e.g. tdharness.local) points, one line in the hosts file:
#       the office LAN address when the company server answers there (TLS chained to the company CA, so a home router
#       or NAS on the same private address is not taken for it)
#       else the server through the tunnel (10.66.0.2) when it answers there
#       else no line: whatever resolved the name before (Tailscale, mDNS) is left to work
# Writes status.json beside it (readable by the desk). Never shows a window.
#
#   win-tunnel-task.ps1 -SelfTest            the parts that need no tunnel, against a scratch hosts file
#   win-tunnel-task.ps1 -Probe <office IP>  is the company server at this address (prints LAN_OK=0/1)
param([string]$Dir = $PSScriptRoot, [switch]$SelfTest, [string]$Probe = '', [string]$HostsFile = '')
$ErrorActionPreference = 'Stop'
$Name = 'tdhdesk'
$Svc = 'WireGuardTunnel$' + $Name
$Mark = '# tdharness-tunnel'
$Net = '10.66.0.'
if (-not $HostsFile) { $HostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts' }
$LogFile = Join-Path $Dir 'task.log'

function Say([string]$m) {
  $l = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss ') + $m
  try {
    if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 1MB) { Move-Item -Force -LiteralPath $LogFile -Destination ($LogFile + '.1') }
    Add-Content -LiteralPath $LogFile -Value $l -Encoding UTF8
  } catch {}
}
function ReadJson([string]$p) { try { return (Get-Content -Raw -LiteralPath $p -Encoding UTF8 | ConvertFrom-Json) } catch { return $null } }
function ReadTrim([string]$p) { try { return ([IO.File]::ReadAllText($p)).Trim() } catch { return '' } }

function Hub {
  $h = ReadJson (Join-Path $Dir 'hub.json')
  if (-not $h) { return $null }
  if ([string]$h.pubkey -notmatch '^[A-Za-z0-9+/]{43}=$') { return $null }
  if ([string]$h.endpoint -notmatch '^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$') { return $null }
  if ([string]$h.server -notlike ($Net + '*')) { return $null }
  return $h
}

# Only one host inside the tunnel, never the hub's (.1) or the server's (.2).
function Address {
  $p = ReadJson (Join-Path $Dir 'enroll\peer.json')
  if (-not $p) { return '' }
  $a = [string]$p.address
  if ($a -notmatch '^10\.66\.0\.(\d{1,3})/32$') { return '' }
  $n = [int]$Matches[1]
  if ($n -lt 3 -or $n -gt 250) { return '' }
  return $a
}

function ConfText($h, [string]$priv, [string]$addr) {
  return "[Interface]`r`nPrivateKey = $priv`r`nAddress = $addr`r`nMTU = 1280`r`n`r`n[Peer]`r`nPublicKey = $($h.pubkey)`r`nEndpoint = $($h.endpoint)`r`nAllowedIPs = ${Net}0/24`r`nPersistentKeepalive = 25`r`n"
}

function TunnelTick {
  $h = Hub
  $addr = Address
  $priv = ReadTrim (Join-Path $Dir 'conf\private.key')
  if (-not $h -or -not $addr -or $priv -notmatch '^[A-Za-z0-9+/]{43}=$') { return 'waiting' }
  $wg = [string]$h.wg
  if (-not $wg -or -not (Test-Path -LiteralPath $wg -PathType Leaf)) { return 'no-wireguard' }
  $conf = Join-Path $Dir ('conf\' + $Name + '.conf')
  $want = ConfText $h $priv $addr
  $have = ''
  try { $have = [IO.File]::ReadAllText($conf) } catch {}
  $svc = Get-Service -Name $Svc -ErrorAction SilentlyContinue
  if ($have -ne $want -or -not $svc) {
    if ($svc) {
      & $wg /uninstalltunnelservice $Name | Out-Null
      for ($i = 0; $i -lt 40 -and (Get-Service -Name $Svc -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
    }
    [IO.File]::WriteAllText($conf, $want, [Text.Encoding]::ASCII)
    & $wg /installtunnelservice $conf | Out-Null
    Say ('TUNNEL_SERVICE=installed address=' + $addr + ' hub=' + $h.endpoint)
    return 'installed'
  }
  if ($svc.Status -ne 'Running') {
    try { Start-Service -Name $Svc; Say 'TUNNEL_SERVICE=started' } catch { Say ('TUNNEL_SERVICE_START_FAIL=' + $_.Exception.Message) }
  }
  return 'up'
}

function TcpUp([string]$ip, [int]$port, [int]$ms) {
  $c = New-Object Net.Sockets.TcpClient
  try {
    $ar = $c.BeginConnect($ip, $port, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne($ms)) { return $false }
    $c.EndConnect($ar); return $true
  } catch { return $false } finally { $c.Close() }
}

# The company server at this address: its login port's certificate chains to the company CA.
function CompanyAt([string]$ip, [string]$sni) {
  $caFile = Join-Path $Dir 'company-ca.crt'
  if (-not $ip -or -not (Test-Path -LiteralPath $caFile)) { return $false }
  $script:Ca = New-Object Security.Cryptography.X509Certificates.X509Certificate2 $caFile
  $script:CertOk = $false
  $c = New-Object Net.Sockets.TcpClient
  try {
    $ar = $c.BeginConnect($ip, 8443, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne(800)) { return $false }
    $c.EndConnect($ar)
    $c.ReceiveTimeout = 2000; $c.SendTimeout = 2000
    $cb = [Net.Security.RemoteCertificateValidationCallback] {
      param($s, $cert, $chain, $err)
      if (-not $cert) { return $false }
      $ch = New-Object Security.Cryptography.X509Certificates.X509Chain
      $ch.ChainPolicy.RevocationMode = 'NoCheck'
      $ch.ChainPolicy.VerificationFlags = 'AllowUnknownCertificateAuthority'
      [void]$ch.ChainPolicy.ExtraStore.Add($script:Ca)
      if ($chain -and $chain.ChainElements) { foreach ($e in $chain.ChainElements) { [void]$ch.ChainPolicy.ExtraStore.Add($e.Certificate) } }
      $ok = $ch.Build((New-Object Security.Cryptography.X509Certificates.X509Certificate2 $cert))
      $top = $ch.ChainElements[$ch.ChainElements.Count - 1].Certificate
      $script:CertOk = [bool]($ok -and $top.Thumbprint -eq $script:Ca.Thumbprint)
      return $script:CertOk
    }
    $ssl = New-Object Net.Security.SslStream($c.GetStream(), $false, $cb)
    try { $ssl.AuthenticateAsClient($sni, $null, [Security.Authentication.SslProtocols]::Tls12, $false) } catch { return $false }
    finally { $ssl.Dispose() }
    return $script:CertOk
  } catch { return $false } finally { $c.Close() }
}

# One marked line for the host, or none. Other lines are kept as they are.
function SetHosts([string]$file, [string]$hostName, [string]$ip) {
  $lines = @()
  try { $lines = [IO.File]::ReadAllLines($file) } catch {}
  $keep = @($lines | Where-Object { -not $_.TrimEnd().EndsWith($Mark) })
  $next = $keep
  if ($ip) { $next = $keep + @($ip + ' ' + $hostName + ' ' + $Mark) }
  if (($next -join "`n") -eq ($lines -join "`n")) { return $false }
  $tmp = $file + '.tdh.tmp'
  [IO.File]::WriteAllText($tmp, (($next -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
  for ($i = 0; $i -lt 10; $i++) {
    try { Copy-Item -Force -LiteralPath $tmp -Destination $file; break } catch { Start-Sleep -Milliseconds 300 }
  }
  Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  return $true
}

function HostsTick([string]$tunnel) {
  $h = Hub
  if (-not $h -or -not $h.host) { return '' }
  $want = ''
  if ($h.lan -and (CompanyAt ([string]$h.lan) ([string]$h.host))) { $want = [string]$h.lan }
  elseif ($tunnel -eq 'up' -and (TcpUp ([string]$h.server) 445 1500)) { $want = [string]$h.server }
  if (SetHosts $HostsFile ([string]$h.host) $want) {
    try { Clear-DnsClientCache } catch {}
    Say ('HOSTS=' + $(if ($want) { $want } else { 'none' }))
  }
  return $(if ($want) { $want } else { 'none' })
}

function WriteStatus([string]$tunnel, [string]$hosts) {
  $s = [ordered]@{ tunnel = $tunnel; address = (Address); hosts = $hosts; at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
  try { [IO.File]::WriteAllText((Join-Path $Dir 'status.json'), ((ConvertTo-Json $s -Compress) + "`n"), (New-Object Text.UTF8Encoding $false)) } catch {}
}

if ($Probe) { Write-Output ('LAN_OK=' + $(if (CompanyAt $Probe 'tdharness.local') { 1 } else { 0 })); exit 0 }

if ($SelfTest) {
  $t = Join-Path $env:TEMP ('tdh-hosts-' + $PID)
  [IO.File]::WriteAllText($t, "# sample`r`n127.0.0.1 localhost`r`n", [Text.Encoding]::ASCII)
  if (-not (SetHosts $t 'tdharness.local' '10.66.0.2')) { throw 'selftest-add' }
  if ((SetHosts $t 'tdharness.local' '10.66.0.2')) { throw 'selftest-same-should-not-write' }
  if (-not (SetHosts $t 'tdharness.local' '172.20.0.80')) { throw 'selftest-switch' }
  $x = [IO.File]::ReadAllText($t)
  if ($x -notmatch '127\.0\.0\.1 localhost' -or $x -match '10\.66\.0\.2' -or ($x -split "`n" | Where-Object { $_ -match 'tdharness' }).Count -ne 1) { throw ('selftest-content ' + $x) }
  if (-not (SetHosts $t 'tdharness.local' '')) { throw 'selftest-remove' }
  if ([IO.File]::ReadAllText($t) -match 'tdharness') { throw 'selftest-removed' }
  Remove-Item -Force -LiteralPath $t
  $c = ConfText ([pscustomobject]@{ pubkey = ('A' * 43 + '='); endpoint = '1.2.3.4:51820' }) ('B' * 43 + '=') '10.66.0.21/32'
  if ($c -notmatch 'Address = 10\.66\.0\.21/32' -or $c -notmatch 'AllowedIPs = 10\.66\.0\.0/24' -or $c -match 'DNS') { throw 'selftest-conf' }
  Write-Output 'WIN_TUNNEL_TASK_SELFTEST_OK'
  exit 0
}

# One keeper at a time (the boot trigger and the 5-minute one).
$mutex = New-Object Threading.Mutex($false, 'Global\TDHarnessTunnelTask')
if (-not $mutex.WaitOne(0)) { exit 0 }
Say 'TASK_START'
$n = 0
$tunnel = 'waiting'; $hosts = ''
while ($true) {
  try { $tunnel = TunnelTick } catch { $tunnel = 'error'; Say ('TUNNEL_ERROR=' + $_.Exception.Message) }
  if ($n % 3 -eq 0 -or $tunnel -eq 'installed') {
    try { $hosts = HostsTick $tunnel } catch { Say ('HOSTS_ERROR=' + $_.Exception.Message) }
  }
  WriteStatus $tunnel $hosts
  $n++
  Start-Sleep -Seconds 5
}
