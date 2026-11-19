# Install Agent Reach (Panniantong/Agent-Reach, MIT) on the site server as the search route's
# channels: web search (Exa), GitHub, YouTube, Bilibili, V2EX and reading a link by its site.
# The gateway (gw-search.js) runs it; desks need nothing. Everything goes under D:\dsh\tools
# (uv, its Python packages and the agent-reach command) and D:\dsh\runtime\agent-reach-home
# (its config: HOME points there, so nothing lands in the service account's profile).
# Pinned: uv and Agent Reach releases with the SHA-256 below; the official install.md way
# (`uv tool install <release zip>`). Re-run to repair; it replaces the tool in place.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
#
#   powershell -ExecutionPolicy Bypass -File server\install-agent-reach.ps1 [-Python C:\...\python.exe] [-Proxy http://127.0.0.1:7890]
#
# Prints AGENT_REACH_INSTALL_OK=1 once `agent-reach web search` answers.
param(
  [string]$Python = '',
  [string]$Proxy = ''
)
$ErrorActionPreference = 'Stop'
$UvVersion = '0.13.9'
$UvSha = 'edd61f7f5728a56cc62455386661860bdfc7bab65872f39b0c25bdcc1d8e1beb'
$ArVersion = '1.6.1'
$ArSha = '51443d733bcb26064262442083a8f8abf6ba5e3e7df54beebafe98c88be04a60'
$Tools = 'D:\dsh\tools'
$ArHome = 'D:\dsh\runtime\agent-reach-home'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Fetch([string]$url, [string]$dst, [string]$sha) {
  if ((Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLower() -eq $sha)) { return }
  $tmp = $dst + '.part'
  $a = @{ Uri = $url; OutFile = $tmp; UseBasicParsing = $true }
  if ($Proxy) { $a.Proxy = $Proxy }
  Invoke-WebRequest @a
  $got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $sha) { Remove-Item -LiteralPath $tmp -Force; throw ('AGENT_REACH_INSTALL_FAIL sha256 ' + $url) }
  Move-Item -Force -LiteralPath $tmp -Destination $dst
}

# Native programs write progress to stderr; judge them by exit code only.
function Native([scriptblock]$cmd) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $cmd 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
  return ,@($out)
}

if (-not $Python) {
  $c = Get-Command python -ErrorAction SilentlyContinue
  if ($c -and $c.Source -notmatch 'WindowsApps') { $Python = $c.Source }
}
if (-not $Python -or -not (Test-Path -LiteralPath $Python)) { throw 'AGENT_REACH_INSTALL_FAIL python-missing (Agent Reach needs Python 3.10+; pass -Python)' }

New-Item -ItemType Directory -Force -Path $Tools, (Join-Path $Tools 'uv'), (Join-Path $Tools 'bin'), $ArHome | Out-Null

# 1. uv, as a plain binary (no installer script, no PATH change)
$uvZip = Join-Path $Tools ('uv-' + $UvVersion + '-x86_64-pc-windows-msvc.zip')
Fetch ('https://github.com/astral-sh/uv/releases/download/' + $UvVersion + '/uv-x86_64-pc-windows-msvc.zip') $uvZip $UvSha
Expand-Archive -Force -LiteralPath $uvZip -DestinationPath (Join-Path $Tools 'uv')
$uv = Join-Path $Tools 'uv\uv.exe'
if (-not (Test-Path -LiteralPath $uv)) { throw 'AGENT_REACH_INSTALL_FAIL uv.exe missing after unzip' }

# 2. Agent Reach from its GitHub release (not PyPI: a different package has that name there)
$arZip = Join-Path $Tools ('agent-reach-' + $ArVersion + '.zip')
Fetch ('https://github.com/Panniantong/Agent-Reach/releases/download/v' + $ArVersion + '/agent-reach.zip') $arZip $ArSha
$env:UV_TOOL_DIR = Join-Path $Tools 'uv-tools'
$env:UV_TOOL_BIN_DIR = Join-Path $Tools 'bin'
$env:UV_CACHE_DIR = Join-Path $Tools 'uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Tools 'uv-python'
if ($Proxy) { $env:HTTPS_PROXY = $Proxy; $env:HTTP_PROXY = $Proxy }
$o = Native { & $uv tool install --force --python $Python $arZip }
if ($LASTEXITCODE -ne 0) { throw ('AGENT_REACH_INSTALL_FAIL uv tool install: ' + ($o | Select-Object -Last 3)) }
$ar = Join-Path $Tools 'bin\agent-reach.exe'
if (-not (Test-Path -LiteralPath $ar)) { throw 'AGENT_REACH_INSTALL_FAIL agent-reach.exe missing' }

# 3. It answers: one web search, as the gateway will run it
$env:HOME = $ArHome
$o = Native { & $ar web search 'polyurethane screen panel' --limit 1 }
$txt = ($o -join "`n")
if ($LASTEXITCODE -ne 0 -or $txt -notmatch '"ok":\s*true') { throw ('AGENT_REACH_INSTALL_FAIL web search: ' + $txt.Substring(0, [Math]::Min(300, $txt.Length))) }
Write-Output ('AGENT_REACH=' + $ar + ' version ' + $ArVersion)
Write-Output 'AGENT_REACH_INSTALL_OK=1'
