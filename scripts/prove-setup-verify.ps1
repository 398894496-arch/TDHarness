# Windows CI: company-setup-verify-v1. Setup.exe checks the pack it downloaded against the sha256 the
# server's version.json gives for "win" before unpacking it (server\SetupStub.cs). This compiles the real
# Setup source with a stand-in Site and checks how that sha256 is read: the "win" one, not "mac"; not one
# inside a nested object (deltas); nothing when version.json is missing or has no "win".
# Prints SETUP_VERIFY_PROVE_OK=1.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path (Split-Path -Parent $here) 'server'
$tmpBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Work = Join-Path $tmpBase ('tdh-setupverify-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc)) { $Csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$fw = Split-Path -Parent $Csc

$site = @'
internal static class Site
{
    internal const string Host = "tdh.example";
    internal const string ZipUrl = "https://tdh.example:8443/client/CompanyDesk-win.zip?v=login1";
}
'@
$driver = @'
using System;
internal static class Prove
{
    private static int fails;
    private static void Is(bool ok, string what) { if (!ok) { fails++; Console.WriteLine("FAIL " + what); } }
    private static int Main()
    {
        string w = new string('a', 64), m = new string('b', 64), d = new string('c', 64);
        var plain = "{\"schema\":\"DSHPACK1\",\"win\":{\"mark\":\"x\",\"sha256\":\"" + w + "\"},\"mac\":{\"sha256\":\"" + m + "\"}}";
        Is(Setup.ServedWinSha(plain) == w, "win sha read");
        var macFirst = "{\"mac\":{\"sha256\":\"" + m + "\"},\"win\":{\"bytes\":5,\"sha256\":\"" + w.ToUpperInvariant() + "\"}}";
        Is(Setup.ServedWinSha(macFirst) == w, "mac first, upper case");
        var nested = "{\"win\":{\"mark\":\"x\",\"deltas\":{\"old\":{\"sha256\":\"" + d + "\",\"file\":\"d.zip\"}},\"sha256\":\"" + w + "\"}}";
        Is(Setup.ServedWinSha(nested) == w, "nested delta sha ignored");
        var onlyNested = "{\"win\":{\"deltas\":{\"old\":{\"sha256\":\"" + d + "\"}}}}";
        Is(Setup.ServedWinSha(onlyNested) == "", "a nested sha is not the pack's");
        Is(Setup.ServedWinSha(null) == "" && Setup.ServedWinSha("") == "" && Setup.ServedWinSha("<html>") == "", "no version.json");
        Is(Setup.ServedWinSha("{\"mac\":{\"sha256\":\"" + m + "\"}}") == "", "no win entry");
        Is(Setup.ServedWinSha("{\"win\":{\"sha256\":\"1234\"}}") == "", "short sha refused");
        Console.WriteLine(fails == 0 ? "UNIT_OK=1" : "UNIT_FAILS=" + fails);
        return fails == 0 ? 0 : 1;
    }
}
'@
$siteCs = Join-Path $Work 'Site.cs'
$driverCs = Join-Path $Work 'Prove.cs'
[IO.File]::WriteAllText($siteCs, $site)
[IO.File]::WriteAllText($driverCs, $driver)
$exe = Join-Path $Work 'prove.exe'
$o = & $Csc /nologo /target:exe /main:Prove /out:$exe (('/r:' + (Join-Path $fw 'System.Windows.Forms.dll'))) (('/r:' + (Join-Path $fw 'System.Drawing.dll'))) (('/r:' + (Join-Path $fw 'System.IO.Compression.dll'))) (Join-Path $server 'SetupStub.cs') (Join-Path $server 'TailnetJoin.cs') $siteCs $driverCs 2>&1
if ($LASTEXITCODE -ne 0) { $o | ForEach-Object { Write-Output "$_" }; throw 'SETUP_VERIFY_PROVE_FAIL compile' }
$r = & $exe 2>&1 | ForEach-Object { "$_" }
$r | ForEach-Object { Write-Output $_ }
Remove-Item -Recurse -Force -LiteralPath $Work -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0 -or -not ($r -contains 'UNIT_OK=1')) { throw 'SETUP_VERIFY_PROVE_FAIL' }
Write-Output 'SETUP_VERIFY_PROVE_OK=1'
