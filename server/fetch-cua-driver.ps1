# Fetch Cua Driver (trycua/cua, MIT) for the client packs: the Windows x64 zip and the macOS
# universal tarball of one pinned release, checked against the SHA-256 below (taken from the
# release's SHA256SUMS). publish-site-update.ps1 puts them into the packs at publish time.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
#
#   powershell -ExecutionPolicy Bypass -File server\fetch-cua-driver.ps1 [-Proxy http://127.0.0.1:7890]
#
# Files already there with the right hash are kept. Prints CUA_DRIVER_FETCH_OK=1.
# To move to a new release: change $Version and both hashes (from that release's SHA256SUMS).
param([string]$Proxy = '')
$ErrorActionPreference = 'Stop'
$Version = '0.54.0'
$Want = [ordered]@{
  ('cua-driver-rs-' + $Version + '-windows-x86_64.zip') = 'c0b92cb56ec7863ca177a2813bf5e22bdea5772a56f5bc4e8be064eed34498d7'
  ('cua-driver-rs-' + $Version + '-darwin-universal.tar.gz') = 'd0d29e62a6f54454ad637f7b738c8b6dcff6538d7d03e505c87ad1f8c13685d2'
}
$Dir = Join-Path 'D:\dsh\runtime\vendor\cua-driver' $Version
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
foreach ($name in $Want.Keys) {
  $dst = Join-Path $Dir $name
  $ok = (Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLower() -eq $Want[$name])
  if (-not $ok) {
    $url = 'https://github.com/trycua/cua/releases/download/cua-driver-rs-v' + $Version + '/' + $name
    $tmp = $dst + '.part'
    $a = @{ Uri = $url; OutFile = $tmp; UseBasicParsing = $true }
    if ($Proxy) { $a.Proxy = $Proxy }
    Invoke-WebRequest @a
    $got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $Want[$name]) { Remove-Item -LiteralPath $tmp -Force; throw ('CUA_DRIVER_FETCH_FAIL sha256 ' + $name) }
    Move-Item -Force -LiteralPath $tmp -Destination $dst
  }
  Write-Output ('CUA_DRIVER ' + $name + ' sha256 ok')
}
Set-Content -LiteralPath (Join-Path 'D:\dsh\runtime\vendor\cua-driver' 'current.txt') -Value $Version -Encoding ASCII
Write-Output 'CUA_DRIVER_FETCH_OK=1'
