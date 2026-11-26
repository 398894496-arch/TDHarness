# company-wg-desk-win-v1: this PC's end of the company tunnel (the Qingdao hub, company-wg-hub-v1). Run elevated, once:
# TDHarness.exe starts it with Windows' own "allow this app to make changes" prompt after sign-in (AppHost.EnsureTunnel).
#
# The user, 2026-11-25: 「我要求改好以后任何客户端都不要弹出这个窗口，默认连接新买的服务器」 — no Tailscale; every desk
# reaches the company server (10.66.0.2) through the company's own WireGuard hub. The Mac does the same with tdh-tunnel.
#
# What it puts in place:
#   C:\Program Files\WireGuard\wireguard.exe   WireGuard for Windows (signed by WireGuard LLC; checked before use). One
#                                              already installed there is used as it is.
#   C:\ProgramData\TDHarness\tunnel\           hub.json (where the tunnel goes, written here only), public.key, the
#                                              company CA, win-tunnel-task.ps1; readable by everyone, changed by admins
#     conf\                                    private.key and the tunnel's config: SYSTEM and admins only
#     enroll\                                  peer.json, the address the desk was given after sign-in: users may write
#   Task \TDHarness\TDHarness Tunnel           win-tunnel-task.ps1 as SYSTEM, from boot: keeps the tunnel service
#                                              (WireGuardTunnel$tdhdesk) on the enrolled address and points the
#                                              company host name at the office LAN or at the tunnel (hosts file)
#   SMB multichannel off                       an extra channel over another adapter (Tailscale) stalled the share
#                                              on the Mac (2026-11-25); one connection to the server is all a desk needs
# Exit: 0 installed, 2 bad input, 3 WireGuard missing or not signed, 4 no key, 5 task, 6 on the company server.
param(
  [Parameter(Mandatory = $true)][string]$Wg,
  [Parameter(Mandatory = $true)][string]$HubKey,
  [Parameter(Mandatory = $true)][string]$HubEndpoint,
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$HostName,
  [Parameter(Mandatory = $true)][string]$Task,
  [Parameter(Mandatory = $true)][string]$Node,
  [string]$Lan = '',
  [string]$Ca = ''
)
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:ProgramData 'TDHarness\tunnel'
$Log = Join-Path $env:ProgramData 'TDHarness\tunnel-install.log'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
function Say([string]$m) { $l = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss ') + $m; Write-Output $l; try { Add-Content -LiteralPath $Log -Value $l -Encoding UTF8 } catch {} }
function Quit([int]$code, [string]$why) { Say ('TUNNEL_INSTALL_FAIL=' + $why); exit $code }

$ip4 = '^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$'
if ($HubKey -notmatch '^[A-Za-z0-9+/]{43}=$') { Quit 2 'hub-key' }
if ($HubEndpoint -notmatch '^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$') { Quit 2 'hub-endpoint' }
if ($Server -notmatch $ip4 -or $Server -notlike '10.66.0.*') { Quit 2 'server' }
if ($Lan -and $Lan -notmatch $ip4) { Quit 2 'lan' }
if ($HostName -notmatch '^[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$') { Quit 2 'host' }
if (-not (Test-Path -LiteralPath $Task -PathType Leaf)) { Quit 2 'task-script' }
if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { Quit 2 'node' }
if (Test-Path -LiteralPath 'D:\dsh\site.yml') { Quit 6 'company-server' }   # the server runs its own end (tdh)

# --- WireGuard for Windows: only the copy WireGuard LLC signed --------------------------------------------------------
function SignedByWireGuard([string]$p) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $false }
  $s = Get-AuthenticodeSignature -LiteralPath $p
  return ($s.Status -eq 'Valid' -and $s.SignerCertificate -and $s.SignerCertificate.Subject -match '^CN=WireGuard LLC,')
}
$WgDir = Join-Path $env:ProgramFiles 'WireGuard'
$WgExe = Join-Path $WgDir 'wireguard.exe'
if (SignedByWireGuard $WgExe) { Say ('WG_PRESENT=' + (Get-Item -LiteralPath $WgExe).VersionInfo.ProductVersion) }
else {
  if (-not (SignedByWireGuard $Wg)) { Quit 3 'wireguard-signature' }
  New-Item -ItemType Directory -Force -Path $WgDir | Out-Null
  Copy-Item -Force -LiteralPath $Wg -Destination ($WgExe + '.new')
  if (-not (SignedByWireGuard ($WgExe + '.new'))) { Quit 3 'wireguard-copy' }
  Move-Item -Force -LiteralPath ($WgExe + '.new') -Destination $WgExe
  Say ('WG_INSTALLED=' + (Get-Item -LiteralPath $WgExe).VersionInfo.ProductVersion)
}

# --- folders and who may touch them ------------------------------------------------------------------------------------
$Conf = Join-Path $Dir 'conf'
$Enroll = Join-Path $Dir 'enroll'
New-Item -ItemType Directory -Force -Path $Dir, $Conf, $Enroll | Out-Null
$SYS = '*S-1-5-18'; $ADM = '*S-1-5-32-544'; $USR = '*S-1-5-32-545'
& icacls.exe (Join-Path $env:ProgramData 'TDHarness') /inheritance:r /grant:r "${SYS}:(OI)(CI)F" "${ADM}:(OI)(CI)F" "${USR}:(OI)(CI)RX" /T /C /Q | Out-Null
& icacls.exe $Conf /inheritance:r /grant:r "${SYS}:(OI)(CI)F" "${ADM}:(OI)(CI)F" /T /C /Q | Out-Null
& icacls.exe $Enroll /grant "${USR}:(OI)(CI)M" /C /Q | Out-Null

# --- this PC's key: made here, the private half never leaves conf\ ----------------------------------------------------
$PrivFile = Join-Path $Conf 'private.key'
$PubFile = Join-Path $Dir 'public.key'
$keyRe = '^[A-Za-z0-9+/]{43}=$'
$priv = ''; $pub = ''
try { $priv = ([IO.File]::ReadAllText($PrivFile)).Trim(); $pub = ([IO.File]::ReadAllText($PubFile)).Trim() } catch {}
if ($priv -notmatch $keyRe -or $pub -notmatch $keyRe) {
  $js = "const c=require('crypto');const j=c.generateKeyPairSync('x25519').privateKey.export({format:'jwk'});const b=s=>Buffer.from(s,'base64url').toString('base64');process.stdout.write(b(j.d)+' '+b(j.x))"
  $out = (& $Node -e $js) -join ''
  $parts = $out.Trim() -split ' '
  if ($parts.Count -ne 2 -or $parts[0] -notmatch $keyRe -or $parts[1] -notmatch $keyRe) { Quit 4 'keygen' }
  [IO.File]::WriteAllText($PrivFile, $parts[0] + "`n", [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText($PubFile, $parts[1] + "`n", [Text.Encoding]::ASCII)
  Say 'KEY_MADE=1'
}

# --- where the tunnel goes (root-of-trust: only this elevated script writes it) -----------------------------------------
$hub = [ordered]@{ pubkey = $HubKey; endpoint = $HubEndpoint; server = $Server; lan = $Lan; host = $HostName; wg = $WgExe }
[IO.File]::WriteAllText((Join-Path $Dir 'hub.json'), ((ConvertTo-Json $hub -Compress) + "`n"), (New-Object Text.UTF8Encoding $false))
if ($Ca -and (Test-Path -LiteralPath $Ca -PathType Leaf)) { Copy-Item -Force -LiteralPath $Ca -Destination (Join-Path $Dir 'company-ca.crt') }
Copy-Item -Force -LiteralPath $Task -Destination (Join-Path $Dir 'win-tunnel-task.ps1')

# --- one SMB connection to the server ---------------------------------------------------------------------------------
try {
  if ((Get-SmbClientConfiguration).EnableMultiChannel) { Set-SmbClientConfiguration -EnableMultiChannel $false -Force -Confirm:$false; Say 'SMB_MULTICHANNEL=off' }
} catch { Say ('SMB_MULTICHANNEL_FAIL=' + $_.Exception.Message) }

# --- the keeper, as SYSTEM from boot ----------------------------------------------------------------------------------
try {
  $name = 'TDHarness Tunnel'; $path = '\TDHarness\'
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $act = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Dir 'win-tunnel-task.ps1') + '"')
  $trg = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)))
  $set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $who = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
  try { Stop-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction SilentlyContinue } catch {}
  Register-ScheduledTask -TaskName $name -TaskPath $path -Action $act -Trigger $trg -Settings $set -Principal $who -Force | Out-Null
  Start-ScheduledTask -TaskName $name -TaskPath $path
} catch { Quit 5 ('task ' + $_.Exception.Message) }
Say 'TUNNEL_INSTALLED=1'
exit 0
