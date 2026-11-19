using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Win32;

// 员工电脑上装得上、跑得起来的前置条件（company-compat-v1）。SetupStub.cs 和 AppHost.cs 共用。
//   DirectToSite    连公司服务器一律直连。员工电脑开着 Clash 一类代理的「系统代理」时，HttpWebRequest 默认走它，
//                   代理解析不了 tdharness.local，安装、登录、更新全都失败。公司服务器只在局域网或加密网络里，用不到代理。
//   WebView2Version TDH 的窗口是微软 WebView2。Win11 自带；Win10 靠系统更新装上，关了更新的电脑没有，
//                   以前要到登录成功后才报 webview2-missing。
//   InstallWebView2 从公司服务器下载微软的 WebView2 安装器（发布时核对过是微软签名），静默装好（不要管理员：装给当前用户）。
//   FreeBytes       磁盘剩余空间：程序包 400 多 MB，解开 1.1 GB，下载和解开要同时放得下。
internal static class DeskPrereq
{
    internal const long NeedBytes = 2500L * 1024 * 1024;
    private const string WebView2Client = @"\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    internal static void DirectToSite()
    {
        try { WebRequest.DefaultWebProxy = null; } catch { }
    }

    internal static string WebView2Version()
    {
        var hives = new[] { Registry.LocalMachine, Registry.CurrentUser };
        var keys = new[] { @"SOFTWARE\WOW6432Node" + WebView2Client, @"SOFTWARE" + WebView2Client };
        foreach (var hive in hives)
        {
            foreach (var path in keys)
            {
                try
                {
                    using (var k = hive.OpenSubKey(path))
                    {
                        if (k == null) continue;
                        var pv = k.GetValue("pv") as string;
                        if (!string.IsNullOrEmpty(pv) && pv != "0.0.0.0") return pv;
                    }
                }
                catch { }
            }
        }
        return "";
    }

    // url: the installer on the company server (…/client/MicrosoftEdgeWebview2Setup.exe).
    internal static bool InstallWebView2(string url, Action<string> log, int waitMs)
    {
        var file = Path.Combine(Path.GetTempPath(), "tdh-webview2-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 60000;
            req.ReadWriteTimeout = 120000;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var src = resp.GetResponseStream())
            using (var dst = File.Create(file))
                src.CopyTo(dst);
            string signer = "";
            try
            {
                var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(file));
                signer = cert.Subject;
                if (!new X509Chain().Build(cert)) signer = "";
            }
            catch { signer = ""; }
            if (signer.IndexOf("O=Microsoft Corporation", StringComparison.Ordinal) < 0)
            {
                if (log != null) log("webview2-installer-not-microsoft " + signer);
                return false;
            }
            var p = Process.Start(new ProcessStartInfo(file, "/silent /install") { UseShellExecute = false, CreateNoWindow = true });
            if (p == null || !p.WaitForExit(waitMs))
            {
                if (log != null) log("webview2-install-timeout");
            }
            else if (log != null) log("webview2-install-exit " + p.ExitCode);
            return WebView2Version().Length > 0;
        }
        catch (Exception ex)
        {
            if (log != null) log("webview2-install " + ex.Message);
            return false;
        }
        finally
        {
            try { File.Delete(file); } catch { }
        }
    }

    internal static string WebView2InstallerUrl(string zipUrl)
    {
        var u = zipUrl ?? "";
        var q = u.IndexOf('?');
        if (q >= 0) u = u.Substring(0, q);
        return u.Substring(0, u.LastIndexOf('/') + 1) + "MicrosoftEdgeWebview2Setup.exe";
    }

    internal static long FreeBytes(string path)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(path));
            return new DriveInfo(root).AvailableFreeSpace;
        }
        catch { return -1; }
    }

    // Windows 10 和 11 才有的注册表值（Win7 / 8.1 没有）。内核的 Node 22 和 WebView2 都只支持 10 和 11。
    internal static bool IsWindows10OrLater()
    {
        try
        {
            using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
            {
                if (k == null) return true;
                var major = k.GetValue("CurrentMajorVersionNumber");
                return major != null && Convert.ToInt32(major) >= 10;
            }
        }
        catch { return true; }
    }

    internal static string GbText(long bytes)
    {
        return (bytes / (1024.0 * 1024 * 1024)).ToString("0.0") + " GB";
    }
}
