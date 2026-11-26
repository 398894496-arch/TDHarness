# Keep Microsoft's WebView2 bootstrapper (MicrosoftEdgeWebview2Setup.exe, about 2 MB) on this server for the desks
# that lack the WebView2 Runtime (company-compat-v1): Setup.exe and TDHarness.exe fetch it from the download folder
# and run it for the current user (no administrator needed). It fetches the runtime from Microsoft itself.
# Kept only when Windows says it is signed by Microsoft Corporation; fetched again after 30 days.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
#
#   powershell -ExecutionPolicy Bypass -File server\fetch-webview2.ps1 [-Proxy http://127.0.0.1:7890]
#
# Result: D:\dsh\runtime\vendor\webview2\MicrosoftEdgeWebview2Setup.exe. Prints WEBVIEW2_SETUP_OK=1, or
# WEBVIEW2_SETUP_SKIP=<why> and exits 0 (publishing goes on without it).
param([string]$Root = 'D:\dsh', [string]$Proxy = '')
$ErrorActionPreference = 'Stop'
$dir = Join-Path $Root 'runtime\vendor\webview2'
$exe = Join-Path $dir 'MicrosoftEdgeWebview2Setup.exe'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function IsMicrosoft([string]$f) {
  $sig = Get-AuthenticodeSignature -LiteralPath $f
  return ($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'O=Microsoft Corporation')
}

$fresh = (Test-Path -LiteralPath $exe) -and ((Get-Date) - (Get-Item -LiteralPath $exe).LastWriteTime).TotalDays -lt 30
if (-not $fresh) {
  $tmp = $exe + '.download'
  $got = $false
  foreach ($p in @('', $Proxy, 'http://127.0.0.1:7890')) {
    if ($got) { break }
    if (Test-Path -LiteralPath $tmp) { Remove-Item -Force -LiteralPath $tmp }
    $a = @('-sL', '--max-time', '300', '-o', $tmp)
    if ($p) { $a += @('-x', $p) }
    $ErrorActionPreference = 'Continue'
    & curl.exe @a 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' 2>$null
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $got = ($rc -eq 0) -and (Test-Path -LiteralPath $tmp) -and ((Get-Item -LiteralPath $tmp).Length -gt 500KB) -and (IsMicrosoft $tmp)
  }
  if ($got) { Move-Item -Force -LiteralPath $tmp -Destination $exe }
  elseif (Test-Path -LiteralPath $tmp) { Remove-Item -Force -LiteralPath $tmp }
}
if (-not (Test-Path -LiteralPath $exe)) { Write-Output 'WEBVIEW2_SETUP_SKIP=download-failed'; exit 0 }
if (-not (IsMicrosoft $exe)) { Write-Output 'WEBVIEW2_SETUP_SKIP=signature-not-microsoft'; exit 0 }
Write-Output ('WEBVIEW2_SETUP_BYTES=' + (Get-Item -LiteralPath $exe).Length)
Write-Output 'WEBVIEW2_SETUP_OK=1'
