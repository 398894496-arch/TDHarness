# Publish one client update on a site server: site patches -> (optional) new build mark ->
# recompile TDHarness.exe and Setup.exe -> reseal BUILD.json -> delta packs -> sha256 + signature on version.json.
# Installed desks see the new mark on next launch and offer the update; new installs get it directly.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File publish-site-update.ps1 [-BumpMark]
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([switch]$BumpMark)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

$Server = $PSScriptRoot
$Dist = 'D:\dsh\client-dist'
$SiteYml = if ($env:TDH_SITE) { $env:TDH_SITE } else { 'D:\dsh\site.yml' }
$SitePy = Join-Path $Server 'site-cs.py'
$Patches = Join-Path $Server 'site-patches'
$SignDir = 'D:\dsh\runtime\pack-sign'
$Pub = Join-Path $SignDir 'pack-sign.pub'

function Find-Tool([string[]]$Names, [string[]]$Extra) {
  foreach ($n in $Names) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { return $c.Source }
  }
  foreach ($p in $Extra) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}
$py = Find-Tool @('python', 'python3') @(Get-ChildItem -Path 'C:\Program Files\Python*' -Filter python.exe -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$node = Find-Tool @('node') @((Join-Path $env:USERPROFILE 'tools\node\node.exe'), 'C:\Users\tdhssh\tools\node\node.exe', (Join-Path ${env:ProgramFiles} 'nodejs\node.exe'))
if (-not $py) { throw 'python-missing' }
if (-not $node) { throw 'node-missing' }
if (-not (Test-Path -LiteralPath (Join-Path $SignDir 'pack-sign.key'))) {
  & $node (Join-Path $Server 'pack-sign.js') keygen --dir $SignDir
  if ($LASTEXITCODE -ne 0) { throw 'pack-sign-keygen-failed' }
}
foreach ($p in $SitePy, $Pub, (Join-Path $Patches 'apply_site_patches.py')) { if (-not (Test-Path -LiteralPath $p)) { throw ('missing ' + $p) } }

$History = 'D:\dsh\client-history'
$DeltaPy = Join-Path $Server 'pack-delta.py'

# 1. Backup, and keep the packs desks have now: the deltas in step 5 are cut against them
$bak = 'D:\dsh\client-dist-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $Dist -Destination $bak -Recurse
Write-Output ('BACKUP=' + $bak)
& $py $DeltaPy remember --dist $Dist --history $History
if ($LASTEXITCODE -ne 0) { throw 'delta-remember-failed' }

# 2. Site patches (idempotent). With this server's Caddy root exported, desks reach the
#    gateway over TLS (8443/gw) and carry the root; TDHarness.exe in step 3 follows the same file.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'export-ca.ps1')
if ($LASTEXITCODE -ne 0) { throw 'export-ca-failed' }
$Ca = 'D:\dsh\runtime\company-ca.crt'
$DeskPlugins = Join-Path (Split-Path -Parent $Server) 'desk\plugins'
foreach ($name in 'CompanyDesk-win.zip', 'CompanyDesk-mac.zip') {
  $zip = Join-Path $Dist $name
  if (-not (Test-Path -LiteralPath $zip)) { continue }
  # The desk plugins from this repository (desk\plugins) replace the pack's copy first, so a
  # change to a plugin's source reaches the desks with this publish.
  if (Test-Path -LiteralPath $DeskPlugins) {
    & $py $SitePy --site $SiteYml overlay-zip --src $zip --plugins $DeskPlugins
    if ($LASTEXITCODE -ne 0) { throw ('overlay-failed-' + $name) }
  }
  $a = @((Join-Path $Patches 'apply_site_patches.py'), '--zip', $zip, '--patches', $Patches, '--pub', $Pub)
  if (Test-Path -LiteralPath $Ca) { $a += @('--ca', $Ca) }
  if ($BumpMark) { $a += '--bump-mark' }
  & $py @a
  if ($LASTEXITCODE -ne 0) { throw ('patch-failed-' + $name) }
}

# 2b. Remote desks over the site's tailnet: the join key, the server's tailnet address and Tailscale's MSI
#     go into the Windows pack (vendor\); pack-setup.ps1 also builds the remote Setup from them.
#     Without runtime\tailscale\desk.key nothing changes (TAILNET_SKIP=no-desk-key).
$tn = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'tailnet-site.ps1') 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Output $tn; throw 'tailnet-site-failed' }
Write-Output $tn.Trim()
if ($tn -match 'TAILNET_SITE_OK=1') {
  & $py $SitePy --site $SiteYml put-zip --src (Join-Path $Dist 'CompanyDesk-win.zip') --file 'D:\dsh\runtime\tailscale\vendor' --name 'CompanyDesk/vendor/'
  if ($LASTEXITCODE -ne 0) { throw 'tailnet-vendor-put-failed' }
  Copy-Item -Force 'D:\dsh\runtime\tailscale\vendor\tailscale-setup.msi' (Join-Path $Dist 'tailscale-setup.msi')
}

# 2c. Desktop control (company-desktop-cua-v1): Cua Driver from the release archives that
#     fetch-cua-driver.ps1 checked (vendor\cua-driver\current.txt names the version). The Windows
#     pack gets the driver and its UI Automation helper; the Mac pack gets CuaDriver.app, which
#     start.command copies to /Applications. Modes and the app's signature come through as shipped.
$CuaRoot = 'D:\dsh\runtime\vendor\cua-driver'
$CuaCur = Join-Path $CuaRoot 'current.txt'
if (Test-Path -LiteralPath $CuaCur) {
  $cv = (Get-Content -LiteralPath $CuaCur -Raw).Trim()
  $cd = Join-Path $CuaRoot $cv
  $cuaPacks = @(
    @{ zip = 'CompanyDesk-win.zip'; archive = ('cua-driver-rs-' + $cv + '-windows-x86_64.zip'); keep = 'cua-driver.exe,cua-driver-uia.exe,LICENSE,THIRD_PARTY_NOTICES.md' },
    @{ zip = 'CompanyDesk-mac.zip'; archive = ('cua-driver-rs-' + $cv + '-darwin-universal.tar.gz'); keep = 'CuaDriver.app/,LICENSE,THIRD_PARTY_NOTICES.md' }
  )
  foreach ($c in $cuaPacks) {
    $zip = Join-Path $Dist $c.zip
    if (-not (Test-Path -LiteralPath $zip)) { continue }
    $arc = Join-Path $cd $c.archive
    if (-not (Test-Path -LiteralPath $arc)) { throw ('cua-driver-archive-missing ' + $arc) }
    $o = & $py $SitePy --site $SiteYml put-zip-archive --src $zip --archive $arc --name 'CompanyDesk/cua-driver/' --keep $c.keep
    if ($LASTEXITCODE -ne 0) { throw ('cua-driver-put-failed-' + $c.zip) }
    Write-Output ('CUA_DRIVER ' + $cv + ' ' + $c.zip + ' ' + $o)
  }
} else {
  Write-Output 'CUA_DRIVER_SKIP=not-fetched (run server\fetch-cua-driver.ps1)'
}

# 2d. Browser (company-opencli-v2): the OpenCLI bundle fetch-opencli.ps1 built (vendor\opencli\current.txt
#     names the version) replaces opencli\ in both packs: the package with its dependencies and the
#     Chrome extension of the same release.
$OclRoot = 'D:\dsh\runtime\vendor\opencli'
$OclCur = Join-Path $OclRoot 'current.txt'
if (Test-Path -LiteralPath $OclCur) {
  $ov = (Get-Content -LiteralPath $OclCur -Raw).Trim()
  $odir = Join-Path $OclRoot ($ov + '\opencli')
  if (-not (Test-Path -LiteralPath (Join-Path $odir 'node_modules\@jackwener\opencli\dist\src\main.js'))) { throw ('opencli-bundle-missing ' + $odir) }
  foreach ($name in 'CompanyDesk-win.zip', 'CompanyDesk-mac.zip') {
    $zip = Join-Path $Dist $name
    if (-not (Test-Path -LiteralPath $zip)) { continue }
    $o = & $py $SitePy --site $SiteYml put-zip-archive --src $zip --archive $odir --name 'CompanyDesk/opencli/' --keep 'node_modules/,extension/,package.json'
    if ($LASTEXITCODE -ne 0) { throw ('opencli-put-failed-' + $name) }
    Write-Output ('OPENCLI ' + $ov + ' ' + $name + ' ' + $o)
  }
} else {
  Write-Output 'OPENCLI_SKIP=not-fetched (run server\fetch-opencli.ps1)'
}

# 3. TDHarness.exe carries the build mark and the site address; Setup.exe carries the site address
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'compile-apphost.ps1')
if ($LASTEXITCODE -ne 0) { throw 'compile-apphost-failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Server 'pack-setup.ps1')
if ($LASTEXITCODE -ne 0) { throw 'pack-setup-failed' }

# 4. Reseal, or tree-check reports TREE_OK=0 forever
foreach ($name in 'CompanyDesk-win.zip', 'CompanyDesk-mac.zip') {
  $zip = Join-Path $Dist $name
  if (-not (Test-Path -LiteralPath $zip)) { continue }
  $o = & $py $SitePy --site $SiteYml reseal-zip --src $zip
  if ($LASTEXITCODE -ne 0) { throw ('reseal-failed-' + $name) }
  Write-Output ($name + ' ' + $o)
}

# 5. version.json + signature
$winP = Join-Path $Dist 'CompanyDesk-win.zip'
$macP = Join-Path $Dist 'CompanyDesk-mac.zip'
$winMark = (& $py $SitePy --site $SiteYml print-mark --src $winP).Trim()
$macMark = $winMark
$macBytes = 0
if (Test-Path -LiteralPath $macP) {
  $got = (& $py $SitePy --site $SiteYml print-mark --src $macP).Trim()
  if ($got.Length -eq 32) { $macMark = $got }
  $macBytes = (Get-Item -LiteralPath $macP).Length
}
$obj = [ordered]@{
  schema = 'DSHPACK1'
  utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss+00:00')
  win = [ordered]@{ mark = $winMark; bytes = (Get-Item -LiteralPath $winP).Length; file = 'CompanyDesk-win.zip' }
  mac = [ordered]@{ mark = $macMark; bytes = $macBytes; file = 'CompanyDesk-mac.zip' }
}
[IO.File]::WriteAllText((Join-Path $Dist 'version.json'), (($obj | ConvertTo-Json -Compress) + "`n"), $Utf8NoBom)
# Delta packs: desks on a recent version download only the changed files (signed with version.json)
& $py $DeltaPy build --dist $Dist --history $History
if ($LASTEXITCODE -ne 0) { throw 'delta-build-failed' }
$ErrorActionPreference = 'Continue'
$signOut = & $node (Join-Path $Server 'pack-sign.js') sign --dist $Dist --dir $SignDir 2>&1 | Out-String
$signRc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Write-Output $signOut.Trim()
if ($signRc -ne 0) { throw 'pack-sign-failed' }
Write-Output ('WIN_MARK=' + $winMark)
Write-Output ('MAC_MARK=' + $macMark)
Write-Output 'PUBLISH_OK=1'
