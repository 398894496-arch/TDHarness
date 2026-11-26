// company-desk-hub-v1: desk-hub-launch.exe — start a person's desk kernel as their own Windows account.
//
// desk_hub.js writes one JSON object to stdin: {user, password, exe, args[], cwd, env{}, stdout, stderr}. The password
// comes only this way (never on a command line, never in a file). The process is started through Windows' secondary
// logon (CreateProcessWithLogonW, with the account's profile), so it can reach exactly what that account can: the
// person's folders on the share by their NTFS rights, and its own desk folder that the hub granted it. Its output goes
// to the two files through cmd.exe. Prints PID=<id> (cmd.exe, the parent of the kernel; the hub stops the tree).
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class DeskHubLaunch
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessWithLogonW(string user, string domain, string password, int logonFlags,
        string app, StringBuilder cmdLine, int creationFlags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool LogonUserW(string user, string domain, string password, int type, int provider, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUserW(IntPtr token, string app, StringBuilder cmdLine, IntPtr pa, IntPtr ta, bool inherit,
        int creationFlags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(IntPtr h, out uint code);

    private const int LOGON_WITH_PROFILE = 1;
    private const int CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_NO_WINDOW = 0x08000000;
    private const int STARTF_USESHOWWINDOW = 1;

    // One argument for cmd.exe's inner command line: quoted when needed, embedded quotes doubled for cmd.
    private static string Q(string a)
    {
        if (a == null) a = "";
        if (a.IndexOfAny(new[] { '"', '&', '|', '<', '>', '^', '%' }) >= 0) throw new ArgumentException("unsafe argument");
        return a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t' }) < 0 ? a : "\"" + a + "\"";
    }

    private const int LOGON32_LOGON_INTERACTIVE = 2, LOGON32_PROVIDER_DEFAULT = 0;

    // As SYSTEM (the hub's scheduled task): log the account on, then start the program with that token on a window
    // station of its own (lpDesktop ""). Secondary logon (CreateProcessWithLogonW) refuses SYSTEM, and from another
    // account's service session its console programs die initialising (0xC0000142, 2026-11-25).
    private static bool StartAsUser(string user, string pass, StringBuilder line, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi, out int err)
    {
        pi = new PROCESS_INFORMATION();
        IntPtr tok;
        if (!LogonUserW(user, ".", pass, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT, out tok)) { err = Marshal.GetLastWin32Error(); return false; }
        try
        {
            var ok = CreateProcessAsUserW(tok, null, line, IntPtr.Zero, IntPtr.Zero, false, CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW, env, cwd, ref si, out pi);
            err = ok ? 0 : Marshal.GetLastWin32Error();
            return ok;
        }
        finally { CloseHandle(tok); }
    }

    // desk-hub-launch.exe             the job on stdin (the hub's own process)
    // desk-hub-launch.exe --job F     the job in file F, removed once read (a scheduled task has no stdin)
    private static int Main(string[] argv)
    {
        try
        {
            string raw;
            if (argv.Length == 2 && argv[0] == "--job") { raw = File.ReadAllText(argv[1]); File.Delete(argv[1]); }
            else raw = Console.In.ReadToEnd();
            var job = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(raw);
            var user = (string)job["user"];
            var pass = (string)job["password"];
            var exe = (string)job["exe"];
            var cwd = (string)job["cwd"];
            var outFile = (string)job["stdout"];
            var errFile = (string)job["stderr"];
            var args = new List<string>();
            foreach (var a in (object[])job["args"]) args.Add((string)a);

            var inner = new StringBuilder(Q(exe));
            foreach (var a in args) inner.Append(' ').Append(Q(a));
            inner.Append(" 1>").Append(Q(outFile)).Append(" 2>").Append(Q(errFile));
            var cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            var line = new StringBuilder("\"" + cmd + "\" /d /s /c \"" + inner + "\"");

            // The hub's own environment, without its account's personal places, then the job's.
            var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry e in Environment.GetEnvironmentVariables()) env[(string)e.Key] = (string)e.Value;
            foreach (var k in new[] { "USERNAME", "USERDOMAIN", "HOMEPATH", "HOMEDRIVE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "USERPROFILE", "ONEDRIVE" }) env.Remove(k);
            foreach (var kv in (Dictionary<string, object>)job["env"]) env[kv.Key] = (string)kv.Value;
            if (env.ContainsKey("USERPROFILE"))
            {
                var prof = env["USERPROFILE"];
                var tmp = Path.Combine(prof, "tmp");
                Directory.CreateDirectory(tmp);
                env["TEMP"] = tmp; env["TMP"] = tmp;
                env["APPDATA"] = Path.Combine(prof, "AppData", "Roaming");
                env["LOCALAPPDATA"] = Path.Combine(prof, "AppData", "Local");
                Directory.CreateDirectory(env["APPDATA"]); Directory.CreateDirectory(env["LOCALAPPDATA"]);
            }
            var block = new StringBuilder();
            foreach (var kv in env) block.Append(kv.Key).Append('=').Append(kv.Value).Append('\0');
            block.Append('\0');
            var envPtr = Marshal.StringToHGlobalUni(block.ToString());

            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = STARTF_USESHOWWINDOW;
            si.wShowWindow = 0;
            // Not this (service) session's desktop, which the person's account may not open: a console program then dies
            // initialising (0xC0000142) without a line. Empty: Windows gives the new logon a window station of its own.
            si.lpDesktop = "";
            PROCESS_INFORMATION pi;
            bool ok;
            int err;
            if (System.Security.Principal.WindowsIdentity.GetCurrent().IsSystem)
                ok = StartAsUser(user, pass, line, envPtr, cwd, ref si, out pi, out err);
            else
            {
                ok = CreateProcessWithLogonW(user, ".", pass, LOGON_WITH_PROFILE, null, line,
                    CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW, envPtr, cwd, ref si, out pi);
                err = Marshal.GetLastWin32Error();
            }
            Marshal.FreeHGlobal(envPtr);
            pass = null;
            if (!ok)
            {
                Console.WriteLine("LAUNCH_FAIL=" + err + " " + new Win32Exception(err).Message);
                return 2;
            }
            CloseHandle(pi.hThread);
            // Gone within two seconds is a start that failed: say how (the hub stops waiting for the kernel's line).
            if (WaitForSingleObject(pi.hProcess, 2000) == 0)
            {
                uint code;
                GetExitCodeProcess(pi.hProcess, out code);
                CloseHandle(pi.hProcess);
                Console.WriteLine("PID=" + pi.dwProcessId);
                Console.WriteLine("EXITED=0x" + code.ToString("X8"));
                return 0;
            }
            CloseHandle(pi.hProcess);
            Console.WriteLine("PID=" + pi.dwProcessId);
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("LAUNCH_FAIL=" + ex.GetType().Name + " " + ex.Message);
            return 2;
        }
    }
}
