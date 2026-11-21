# Remote desks over the site's tailnet (docs/SERVER.md "Remote use"): gather what a desk needs to join it,
# for publish-site-update.ps1 to put into the Windows pack (vendor\) and into the remote Setup.
#   D:\dsh\runtime\tailscale\desk.key        the employee join key (a Tailscale auth key, reusable, pre-approved);
#                                             the admin puts it here. Without it this script does nothing.
#   -> D:\dsh\runtime\tailscale\vendor\       employee.auth, company-tailnet.txt, tailscale-setup.msi
#   -> D:\dsh\runtime\tailscale\vendor-mac\   employee.auth, company-tailnet.txt, Tailscale.pkg
# company-tailnet.txt is read from this server's own `tailscale status`: its tailnet address and name, the
# address desks check to know they are on the company tailnet. The installer is Tailscale's official MSI,
# downloaded once and kept only if Windows says it is signed by Tailscale Inc.
# Prints TAILNET_SITE_OK=1 (ready), or TAILNET_SKIP=<why> and exits 0 (publish goes on without it).
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([string]$Root = 'D:\dsh')
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $Root 'runtime\tailscale'
$Vendor = Join-Path $Dir 'vendor'
$KeyFile = Join-Path $Dir 'desk.key'
if (-not (Test-Path -LiteralPath $KeyFile)) { Write-Output 'TAILNET_SKIP=no-desk-key'; exit 0 }
$key = ([IO.File]::ReadAllText($KeyFile)).Trim()
if ($key -notmatch ('^ts' + 'key-auth-[A-Za-z0-9-]+$')) { throw 'desk-key-malformed' }

$ts = $null
foreach ($p in @((Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale.exe'))) {
  if ($p -and (Test-Path -LiteralPath $p)) { $ts = $p; break }
}
if (-not $ts) { Write-Output 'TAILNET_SKIP=no-tailscale-on-server'; exit 0 }
$ErrorActionPreference = 'Continue'
$raw = & $ts status --json 2>$null | Out-String
$ErrorActionPreference = 'Stop'
$ip = ([regex]::Match($raw, '"TailscaleIPs"\s*:\s*\[\s*"(100\.[0-9.]+)"')).Groups[1].Value
$node = ([regex]::Match($raw, '"Self"\s*:\s*\{[\s\S]*?"HostName"\s*:\s*"([^"]+)"')).Groups[1].Value
if ($raw -notmatch '"BackendState"\s*:\s*"Running"' -or -not $ip) { Write-Output 'TAILNET_SKIP=server-not-on-tailnet'; exit 0 }

New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $Vendor 'employee.auth'), $key + "`n", $utf8)
[IO.File]::WriteAllText((Join-Path $Vendor 'company-tailnet.txt'), "ip=$ip`nnode=$node`n", $utf8)

$msi = Join-Path $Vendor 'tailscale-setup.msi'
$fresh = (Test-Path -LiteralPath $msi) -and ((Get-Date) - (Get-Item -LiteralPath $msi).LastWriteTime).TotalDays -lt 30
if (-not $fresh) {
  $tmp = $msi + '.download'
  & curl.exe -sL --max-time 600 -o $tmp 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp)) {
    if (Test-Path -LiteralPath $msi) { Write-Output 'TAILNET_MSI=kept-old (download failed)' } else { throw 'msi-download-failed' }
  } else {
    $sig = Get-AuthenticodeSignature -LiteralPath $tmp
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Tailscale Inc\.') { Remove-Item -LiteralPath $tmp -Force; throw 'msi-signature-not-tailscale' }
    Move-Item -Force -LiteralPath $tmp -Destination $msi
  }
}
$sig = Get-AuthenticodeSignature -LiteralPath $msi
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Tailscale Inc\.') { throw 'msi-signature-not-tailscale' }
# The Mac pack (company-mac-tailnet-join-v1): the same two files plus Tailscale's own macOS installer.
# Windows cannot check a pkg signature; the Mac checks it (pkgutil) before installing. Here only its shape.
$VendorMac = Join-Path $Dir 'vendor-mac'
New-Item -ItemType Directory -Force -Path $VendorMac | Out-Null
foreach ($n in 'employee.auth', 'company-tailnet.txt') { Copy-Item -Force -LiteralPath (Join-Path $Vendor $n) -Destination (Join-Path $VendorMac $n) }
$pkg = Join-Path $VendorMac 'Tailscale.pkg'
$fresh = (Test-Path -LiteralPath $pkg) -and ((Get-Date) - (Get-Item -LiteralPath $pkg).LastWriteTime).TotalDays -lt 30
if (-not $fresh) {
  $tmp = $pkg + '.download'
  & curl.exe -sL --max-time 600 -o $tmp 'https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg'
  $ok = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $tmp) -and ((Get-Item -LiteralPath $tmp).Length -gt 5MB)
  if ($ok) {
    $head = New-Object byte[] 4
    $fs = [IO.File]::OpenRead($tmp); try { [void]$fs.Read($head, 0, 4) } finally { $fs.Close() }
    $ok = ([Text.Encoding]::ASCII.GetString($head) -eq 'xar!')
  }
  if ($ok) { Move-Item -Force -LiteralPath $tmp -Destination $pkg }
  else {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -Force -LiteralPath $tmp }
    if (Test-Path -LiteralPath $pkg) { Write-Output 'TAILNET_MAC_PKG=kept-old (download failed)' } else { Write-Output 'TAILNET_MAC_PKG=missing (download failed)' }
  }
}
if (Test-Path -LiteralPath $pkg) { Write-Output ('TAILNET_MAC_PKG_BYTES=' + (Get-Item -LiteralPath $pkg).Length) }

Write-Output ('TAILNET_IP=' + $ip)
Write-Output ('TAILNET_NODE=' + $node)
Write-Output ('TAILNET_MSI_BYTES=' + (Get-Item -LiteralPath $msi).Length)
Write-Output 'TAILNET_SITE_OK=1'
