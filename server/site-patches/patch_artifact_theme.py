"""工件（右侧 HTML 预览）的深浅色跟着桌面的外观设置走（company-artifact-theme-v1，幂等）。

工件页面在预览框里显示。页面按 CSS 的 prefers-color-scheme 选深浅色时，WKWebView（Mac）和 WebView2（Win）
给的是操作系统的外观，不是桌面里选的外观：系统是深色、桌面选了浅色，工件照样是黑底（2026-11-19，TDH 的 Mac）。
（内核自己的 Electron 外壳会把桌面外观转给系统外观，我们的两个外壳没有这一步。）

现在：放进预览框之前，页面里 <style>、media 属性和 CSS 文件中的 (prefers-color-scheme: dark / light) 换成按桌面
外观算好的条件；可交互预览里脚本问 matchMedia('(prefers-color-scheme: dark)') 也按桌面外观回答。
color-scheme: light dark（让浏览器自己挑）换成桌面的那一种。桌面切换外观时预览框重新显示。
"""
MARK = "company-artifact-theme-v1"
TARGET = "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js"

HELPERS = r'''		// company-artifact-theme-v1 helpers start
		// The artifact frame follows the desk's light / dark choice, not the operating system's: our Mac (WKWebView) and
		// Windows (WebView2) shells do not hand the desk's choice to the system the way the Electron shell does, so a page
		// written with prefers-color-scheme went dark on a light desk when the system was dark (2026-11-19, TDH).
		const COMPANY_SCHEME_QUERY = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;
		const COMPANY_SCHEME_PAIR = /(color-scheme\s*:\s*)(?:light\s+dark|dark\s+light)\b/gi;
		function companyThemeCss(css, dark) {
			if (typeof dark !== "boolean") return css;
			return String(css).replace(COMPANY_SCHEME_QUERY, (_, scheme) => scheme.toLowerCase() === "dark" === dark ? "(min-width:0px)" : "(max-width:0px)").replace(COMPANY_SCHEME_PAIR, (_, head) => head + (dark ? "dark" : "light"));
		}
		function companyThemeShim(dark) {
			return "<script>(()=>{const dark=" + (dark ? "true" : "false") + ";const re=/\\(\\s*prefers-color-scheme\\s*:\\s*(dark|light)\\s*\\)/gi;const mm=window.matchMedia&&window.matchMedia.bind(window);if(mm)window.matchMedia=(q)=>mm(String(q).replace(re,(_,s)=>s.toLowerCase()==='dark'===dark?'(min-width:0px)':'(max-width:0px)'));})()</" + "script>";
		}
		function companyThemeHtml(html, dark, script) {
			if (typeof dark !== "boolean") return html;
			const out = String(html).replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, open, css, close) => open + companyThemeCss(css, dark) + close).replace(/(\smedia\s*=\s*)("[^"]*"|'[^']*')/gi, (_, head, value) => head + companyThemeCss(value, dark));
			if (!script) return out;
			const at = out.match(/<head\b[^>]*>/i) || out.match(/<html\b[^>]*>/i) || out.match(/<!doctype[^>]*>/i);
			const cut = at ? at.index + at[0].length : 0;
			return out.slice(0, cut) + companyThemeShim(dark) + out.slice(cut);
		}
		function companyDeskDark() {
			return typeof document !== "undefined" && document.body != null && document.body.hasAttribute("data-ds-dark-theme");
		}
		function companySubscribeDeskDark(notify) {
			if (typeof MutationObserver === "undefined" || typeof document === "undefined" || document.body == null) return () => {};
			const observer = new MutationObserver(notify);
			observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
			return () => observer.disconnect();
		}
		function useCompanyDeskDark() {
			return (0, react.useSyncExternalStore)(companySubscribeDeskDark, companyDeskDark, () => false);
		}
		// company-artifact-theme-v1 helpers end
'''

EDITS = [
    # The bootstrap gets the desk's choice and rewrites the page and its style sheets before they enter the frame.
    ("\t\tfunction createHtmlDocument(bundle) {\n",
     HELPERS + "\t\tfunction createHtmlDocument(bundle, companyDark) {\n"),
    ("\t\t\t\thtml: decodeText(bundle.data),\n\t\t\t\tassets: bundle.assets.map((asset) => ({\n\t\t\t\t\tkind: asset.kind,\n\t\t\t\t\treference: asset.reference,\n\t\t\t\t\ttext: decodeText(asset.data)\n",
     "\t\t\t\thtml: companyThemeHtml(decodeText(bundle.data), companyDark, true),\n\t\t\t\tassets: bundle.assets.map((asset) => ({\n\t\t\t\t\tkind: asset.kind,\n\t\t\t\t\treference: asset.reference,\n\t\t\t\t\ttext: asset.kind === \"script\" ? decodeText(asset.data) : companyThemeCss(decodeText(asset.data), companyDark)\n"),
    # Interactive frame: built for the desk's current choice, rebuilt when it changes.
    ("\t\tfunction HtmlFrame({ data, resourceAddress, readRelated, addResource, setResources, signal, frameName, t }) {\n\t\t\tconst [frame, setFrame] = (0, react.useState)();\n",
     "\t\tfunction HtmlFrame({ data, resourceAddress, readRelated, addResource, setResources, signal, frameName, t }) {\n\t\t\tconst [frame, setFrame] = (0, react.useState)();\n\t\t\tconst companyDark = useCompanyDeskDark();\n"),
    ("\t\t\t\t\t\tconst html = createHtmlDocument(bundle);\n",
     "\t\t\t\t\t\tconst html = createHtmlDocument(bundle, companyDark);\n"),
    ("\t\t\t\taddResource,\n\t\t\t\tsetResources,\n\t\t\t\tsignal\n\t\t\t]);\n",
     "\t\t\t\taddResource,\n\t\t\t\tsetResources,\n\t\t\t\tsignal,\n\t\t\t\tcompanyDark\n\t\t\t]);\n"),
    # Static frame (no scripts): the same rewrite of its style sheets.
    ("\t\tfunction BasicHtmlFrame({ data, frameName, t }) {\n\t\t\tconst html = (0, react.useMemo)(() => {\n\t\t\t\ttry {\n\t\t\t\t\treturn createBasicHtmlDocument(data);\n\t\t\t\t} catch {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t}, [data]);\n",
     "\t\tfunction BasicHtmlFrame({ data, frameName, t }) {\n\t\t\tconst companyDark = useCompanyDeskDark();\n\t\t\tconst html = (0, react.useMemo)(() => {\n\t\t\t\ttry {\n\t\t\t\t\treturn companyThemeHtml(createBasicHtmlDocument(data), companyDark, false);\n\t\t\t\t} catch {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t}, [data, companyDark]);\n"),
]


def patch(t: str):
    if MARK in t:
        return t, "already"
    for old, _ in EDITS:
        if t.count(old) != 1:
            raise SystemExit("artifact-theme-anchor-missing count=%d %r" % (t.count(old), old[:60]))
    for old, new in EDITS:
        t = t.replace(old, new, 1)
    return t, "patched"
