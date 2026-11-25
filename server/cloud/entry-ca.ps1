# company-mobile-entry-v1: the CA of the phones' cloud entry (tdh-entry.nginx.conf), kept on the company server.
#   entry-ca.ps1 -Csr <request.csr> -Out <entry.crt> [-Days 800]
# Made on first use in D:\dsh\runtime\entry-ca (SYSTEM and Administrators only): EC P-256, 10 years, its name
# constraint the site's host only; its key never leaves that folder. Its certificate (entry-ca.crt there) goes into
# the phone app's Site.json as "more_ca" (mobile/ios/make-site.sh); desks never trust it. What it signs: the request
# from install-entry.sh csr on the hub (the key stays there), for the host only, serverAuth, at most 820 days (iOS
# takes no more than 825 for a TLS server certificate). Renew before it ends: csr, sign here, install-entry.sh cert.
# Uses Git for Windows' openssl. Prints ENTRY_CA_OK=1 and the certificate's end date.
param(
  [Parameter(Mandatory = $true)][string]$Csr,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Days = 800,
  [string]$SiteHost = 'tdharness.local',
  [string]$Dir = 'D:\dsh\runtime\entry-ca',
  [string]$OpenSsl = 'C:\Program Files\Git\usr\bin\openssl.exe'
)
$ErrorActionPreference = 'Stop'
if ($Days -lt 1 -or $Days -gt 820) { throw 'ENTRY_CA_FAIL days' }
if ($SiteHost -notmatch '^[a-z0-9.-]+$') { throw 'ENTRY_CA_FAIL host' }
function P([string]$p) { return ($p -replace '\\', '/') }
function Ssl {
  $ErrorActionPreference = 'Continue'   # openssl's notes on stderr are not failures (PowerShell 5.1 makes them errors)
  $o = & $OpenSsl @args 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { throw ('ENTRY_CA_FAIL openssl ' + $args[0] + ': ' + (($o | Select-Object -Last 2) -join ' ')) }
  return $o
}
if (-not (Test-Path -LiteralPath $Dir)) {
  New-Item -ItemType Directory -Path $Dir | Out-Null
  & icacls.exe $Dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ENTRY_CA_FAIL acl' }
}
$key = Join-Path $Dir 'entry-ca.key'
$crt = Join-Path $Dir 'entry-ca.crt'
if (-not (Test-Path -LiteralPath $key)) {
  $cnf = Join-Path $Dir 'ca.cnf'
  Set-Content -LiteralPath $cnf -Encoding ascii -Value @"
[req]
distinguished_name = dn
prompt = no
x509_extensions = ca
[dn]
CN = TDH mobile entry CA ($SiteHost)
[ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
nameConstraints = critical,permitted;DNS:$SiteHost
subjectKeyIdentifier = hash
"@
  Ssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out (P $key) | Out-Null
  Ssl req -new -x509 -config (P $cnf) -key (P $key) -days 3650 -sha256 -out (P $crt) | Out-Null
  Write-Output 'ENTRY_CA_NEW=1'
}
# The request's own signature must hold; its subject and extensions are not used (the certificate names the host only).
Ssl req -in (P $Csr) -noout -verify | Out-Null
$ext = Join-Path $Dir 'leaf.ext'
Set-Content -LiteralPath $ext -Encoding ascii -Value @"
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:$SiteHost
authorityKeyIdentifier = keyid
subjectKeyIdentifier = hash
"@
Ssl x509 -req -in (P $Csr) -CA (P $crt) -CAkey (P $key) -CAcreateserial -days $Days -sha256 -extfile (P $ext) -out (P $Out) | Out-Null
Ssl verify -CAfile (P $crt) (P $Out) | Out-Null
Write-Output ('ENTRY_CA_OK=1 ' + ((Ssl x509 -in (P $Out) -noout -enddate) -join ''))
