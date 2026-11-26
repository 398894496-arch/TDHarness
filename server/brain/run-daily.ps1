# The brain's daily job: read yesterday's conversations where they already are
# (each seat's .dsh-desk on the company folder), write the evidence layer,
# distil one page per person per day, harvest corrections, and put what
# qualifies up for adoption. Nothing leaves this machine except the distilling
# prompt, which goes to the model through this server's own gateway.
#
#   powershell -ExecutionPolicy Bypass -File server\brain\run-daily.ps1 [-Root D:\dsh] [-Node <node.exe>] [-Target yyyy-mm-dd] [-DryRun]
#
# Registered by setup-server.ps1 as the task TDH-Brain-Daily (every day, 00:15).
param(
  [string]$Root = 'D:\dsh',
  [string]$Node = '',
  [string]$Target = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
foreach ($k in 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
$env:NO_PROXY = '*'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Node) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}
if (-not $Node -or -not (Test-Path -LiteralPath $Node)) { throw 'node-missing (pass -Node)' }
$brain = Join-Path $Root 'brain'
$log = Join-Path $brain '90-system\brain-daily'
New-Item -ItemType Directory -Force $log | Out-Null

# company-krouter-nightly-v1: the model work is KRouter's now (below); this job keeps writing the evidence layer
# (L0) and the facts without a model. Its own per-person narrative used Grok, which this site no longer has.
$env:L1_DISTILL = '0'
$env:L1_DISTILL_URL = 'http://127.0.0.1:8450/v1'
$argv = @((Join-Path $here 'brain-daily.js'), '--distill', '--brain-root', $brain, '--company-root', (Join-Path $Root 'company'), '--people-roster', (Join-Path $Root 'runtime\roster.json'))
if (-not $DryRun) { $argv += @('--write', '--allow-prod') }
if ($Target) { $argv += @('--target', $Target) }
$out = & $Node @argv 2>&1 | Out-String
$out | Set-Content -LiteralPath (Join-Path $log 'last-run.log') -Encoding UTF8
Write-Output $out
if ($LASTEXITCODE -ne 0) { throw 'brain-daily-failed' }

# KRouter's nightly for the company memory (server\krouter-nightly.js): yesterday's conversations distilled into
# experience cards in the company memory, the standing index and trigger words, and the hot cycle (60 days).
$kr = @((Join-Path (Split-Path -Parent $here) 'krouter-nightly.js'), '--company-root', (Join-Path $Root 'company'), '--runtime-root', (Join-Path $Root 'runtime'))
if ($DryRun) { $kr += '--dry-run' }
if ($Target) { $kr += @('--target', $Target) }
$krOut = & $Node @kr 2>&1 | Out-String
$krOut | Set-Content -LiteralPath (Join-Path $log 'krouter-last-run.log') -Encoding UTF8
Write-Output $krOut
