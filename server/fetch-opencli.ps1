# Build the OpenCLI bundle the client packs carry in opencli/ (company-opencli-v2): the npm
# package @jackwener/opencli at one pinned version with its dependencies (plain JavaScript, the
# same for Windows and Mac), and the Chrome extension of that release (checked against the
# SHA-256 below, from the release's asset digest). publish-site-update.ps1 swaps it into the packs.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
#
#   powershell -ExecutionPolicy Bypass -File server\fetch-opencli.ps1 [-Proxy http://127.0.0.1:7890]
#
# Result: D:\dsh\runtime\vendor\opencli\<version>\opencli\{node_modules, extension, package.json},
# and vendor\opencli\current.txt naming the version. Prints OPENCLI_FETCH_OK=1.
# To move to a new release: change $Version, $ExtVersion and $ExtSha (the release's extension asset).
param([string]$Proxy = '')
$ErrorActionPreference = 'Stop'
$Version = '2.0.3'
$ExtVersion = '1.0.27'
$ExtSha = '8636d42a0fe44d7ba3b0603dbcd9581e8269ccbca950136d0dfc0ffc39a8a213'
$Root = 'D:\dsh\runtime\vendor\opencli'
$Dir = Join-Path $Root $Version
$Out = Join-Path $Dir 'opencli'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Native([scriptblock]$cmd) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $o = & $cmd 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
  return ,@($o)
}

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd' }
if (-not (Test-Path -LiteralPath $npm)) { throw 'OPENCLI_FETCH_FAIL npm missing' }

$stage = $Dir + '.part'
if (Test-Path -LiteralPath $stage) { Remove-Item -Recurse -Force -LiteralPath $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'opencli') | Out-Null
$pkg = Join-Path $stage 'opencli\package.json'
[IO.File]::WriteAllText($pkg, '{"name":"tdh-opencli","private":true,"description":"OpenCLI ' + $Version + ' for the TDH desk"}' + "`n")

# 1. the package, no install scripts (they only add shell completions and sync a global adapter folder)
if ($Proxy) { $env:HTTPS_PROXY = $Proxy; $env:HTTP_PROXY = $Proxy }
$o = Native { & $npm install --prefix (Join-Path $stage 'opencli') --omit=dev --no-audit --no-fund --ignore-scripts --no-package-lock ('@jackwener/opencli@' + $Version) }
if ($LASTEXITCODE -ne 0) { throw ('OPENCLI_FETCH_FAIL npm: ' + ($o | Select-Object -Last 3)) }
$main = Join-Path $stage 'opencli\node_modules\@jackwener\opencli\dist\src\main.js'
if (-not (Test-Path -LiteralPath $main)) { throw 'OPENCLI_FETCH_FAIL main.js missing' }
$v = (Native { & node $main --version }) -join ''
if ($v.Trim() -ne $Version) { throw ('OPENCLI_FETCH_FAIL version is ' + $v) }

# 2. the extension of the same release
$zip = Join-Path $stage ('opencli-extension-v' + $ExtVersion + '.zip')
$a = @{ Uri = ('https://github.com/jackwener/opencli/releases/download/v' + $Version + '/opencli-extension-v' + $ExtVersion + '.zip'); OutFile = $zip; UseBasicParsing = $true }
if ($Proxy) { $a.Proxy = $Proxy }
Invoke-WebRequest @a
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower() -ne $ExtSha) { throw 'OPENCLI_FETCH_FAIL extension sha256' }
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $stage 'opencli\extension')
Remove-Item -LiteralPath $zip
$man = Get-Content -Raw -LiteralPath (Join-Path $stage 'opencli\extension\manifest.json') | ConvertFrom-Json
if ($man.version -ne $ExtVersion) { throw ('OPENCLI_FETCH_FAIL extension version ' + $man.version) }

if (Test-Path -LiteralPath $Dir) { Remove-Item -Recurse -Force -LiteralPath $Dir }
Move-Item -LiteralPath $stage -Destination $Dir
Set-Content -LiteralPath (Join-Path $Root 'current.txt') -Value $Version -Encoding ASCII
Write-Output ('OPENCLI=' + $Version + ' extension ' + $ExtVersion + ' at ' + $Out)
Write-Output 'OPENCLI_FETCH_OK=1'
