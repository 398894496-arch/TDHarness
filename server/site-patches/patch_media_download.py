"""生成的图片、视频在对话里直接显示，并能一键下载（幂等）。

1. dsh-better-sidebar/lib/index.js：会话内相对路径（如 artifacts/x.mp4）按会话工作目录解析。
   原来原样传给 requireAbsolute，下载路由回 400「is not an absolute path」，WebView2 把这段
   JSON 存成失败的 file.json。
2. dsh-better-sidebar/lib/client.js：侧边栏文件预览工具栏加常驻「下载到本机」按钮。
3. company-grok-media/lib/index.js：generate_image / generate_video 返回绝对路径。
4. 内核 dsh-client-ui-deliverables/lib/client.js：AI 交付（present）的文件卡片，图片在对话里
   显示缩略图（点开在侧边栏看大图），视频显示播放器，每张卡片加「下载」按钮；字节走
   dsh-better-sidebar 的 /sidebar/file 路由（两个客户端包都带）。
5. 同一处：图片、视频按原始宽高比显示（company-inline-media-aspect-v1）。外面是纵向 flex，
   默认把子元素横向拉满，高度又被 maxHeight 卡住，图就被拉扁了。改成靠左、宽高 auto、
   object-fit: contain。已经打过 4 的包只补这一处。
6. 服务器工作台（company-server-share-path-v1）：内核在公司服务器上跑时，会话里写的共享盘路径
   「\\\\tdharness.local\\dsh-company\\…」在服务器自己这里打不开（stat 报 UNKNOWN，下载存成 file.json、对话里
   的图裂掉）。TDH_COMPANY_LOCAL（desk_hub.js 给）在时，这个前缀换成服务器本机的公司目录。
7. 不给下载，给「在文件夹中显示」（company-local-reveal-v1，用户 2026-11-26：「直接不给下载按钮了 直接给一个
   从文件夹打开的按钮」）：交付卡片去掉下载按钮（手机上保留，手机没有文件夹）；卡片的「在文件管理器中显示」
   先问这台电脑的本机中转（desk-hub-relay.js 的 /_tdh/reveal），由它在员工自己的电脑上打开公司盘里的文件夹并
   选中文件；没有本机中转（电脑自己跑内核）时照旧交给内核。侧边栏预览顶栏的下载按钮同样换成这个。
8. 下载按钮回来，和文件夹按钮并排（company-download-beside-folder-v1，用户 2026-11-26：「如果想保存在本地怎么办」
   「加回下载按钮」）：6 修好以后下载能用了。卡片在电脑上也给下载；侧边栏预览顶栏在「在文件夹中显示」旁边加回
   「下载到本机」。已经打过 7 的包只补这一处。
"""
import sys
from pathlib import Path

MARK_RESOLVE = "company-sidebar-relative-path-v1"
MARK_BUTTON = "company-sidebar-download-button-v1"
MARK_MEDIA = "company-media-absolute-paths-v1"
MARK_CARD = "company-presented-inline-media-v1"
MARK_ASPECT = "company-inline-media-aspect-v1"
MARK_UNC = "company-server-share-path-v1"
MARK_REVEAL = "company-local-reveal-v1"
MARK_BOTH = "company-download-beside-folder-v1"

BOX_V1 = '\t\t\tconst box = { display: "block", maxWidth: "100%", maxHeight: 360, borderRadius: 8, marginTop: 6, background: "#000" };\n'
BOX_V2 = (
    "\t\t\t// " + MARK_ASPECT + ": keep the picture's own proportions. The card is a flex column, which\n"
    "\t\t\t// stretches children to its width while maxHeight caps the height.\n"
    '\t\t\tconst box = { display: "block", maxWidth: "100%", maxHeight: 360, width: "auto", height: "auto", '
    'alignSelf: "flex-start", objectFit: "contain", borderRadius: 8, marginTop: 6, background: "#000" };\n'
)


def edit_text(text: str, marker: str, old: str, new: str) -> tuple[str, str]:
    if marker in text:
        return text, "already"
    if text.count(old) != 1:
        raise SystemExit("anchor-missing:" + marker)
    return text.replace(old, new, 1), "patched"


def chain(t: str, *steps) -> tuple[str, str]:
    """Run edits in order; "patched" when any of them changed the text."""
    hows = []
    for fn in steps:
        t, how = fn(t)
        hows.append(how)
    return t, ("patched" if "patched" in hows else "already" if "already" in hows else hows[-1])


REVEAL_HELPER = """		// company-local-reveal-v1: show a company file in the file manager of THIS computer. The desk window's own
		// relay (desk-hub-relay.js, server desks) answers /_tdh/reveal with {tdhLocal: true}; anything else (a desk whose
		// kernel runs on this computer, the phone) is "none" and the caller keeps its old way.
		async function companyRevealLocal(path) {
			try {
				const response = await fetch("/_tdh/reveal", {
					method: "POST",
					headers: { "Content-Type": "application/json", "X-TDH-Local": "1" },
					body: JSON.stringify({ path: String(path || "") })
				});
				const answer = await response.json().catch(() => null);
				if (answer && answer.tdhLocal === true) return answer.ok === true ? "ok" : "fail";
			} catch {}
			return "none";
		}
		function companyIsPhone() {
			return typeof navigator !== "undefined" && /TDH-iOS/.test(navigator.userAgent || "");
		}
"""


def patch_sidebar_unc(t: str) -> tuple[str, str]:
    return edit_text(t, MARK_UNC,
        "function requireAbsolute(path) {\n",
        "// " + MARK_UNC + ": on the company server (TDH_COMPANY_LOCAL, desk_hub.js) the share's own name\n"
        "// (\\\\<host>\\dsh-company\\...) is the server's local company folder; the server cannot reach itself by that name.\n"
        "function companyLocalPath(path) {\n"
        "\tconst root = process.env.TDH_COMPANY_LOCAL;\n"
        "\tif (!root || typeof path !== \"string\") return path;\n"
        "\tconst m = /^[\\\\/]{2}[^\\\\/]+[\\\\/]dsh-company(?=[\\\\/]|$)/i.exec(path);\n"
        "\treturn m ? root + path.slice(m[0].length).replace(/\\//g, \"\\\\\") : path;\n"
        "}\n"
        "function requireAbsolute(path) {\n"
        "\tpath = companyLocalPath(path);\n")


def patch_sidebar_index(t: str) -> tuple[str, str]:
    return chain(t, patch_sidebar_resolve, patch_sidebar_unc)


def patch_sidebar_resolve(t: str) -> tuple[str, str]:
    return edit_text(t, MARK_RESOLVE,
        "function resolveSessionPath(cwd, target, platform = process.platform) {\n",
        "function resolveSessionPath(cwd, target, platform = process.platform) {\n"
        "\t// " + MARK_RESOLVE + ": a session-relative path resolves under the session cwd.\n"
        "\tif (typeof cwd === \"string\" && cwd !== \"\" && typeof target === \"string\" && target !== \"\" && !isAbsolute(target)) return join(cwd, target);\n")


def patch_sidebar_client(t: str) -> tuple[str, str]:
    return chain(t, patch_sidebar_button, patch_sidebar_reveal, patch_sidebar_both)


def patch_sidebar_both(t: str) -> tuple[str, str]:
    if MARK_BOTH in t:
        return t, "already"
    anchor = "\t\t\t\t\t\t// " + MARK_REVEAL + ": show the open file in this computer's file manager; a desk without the relay\n"
    if t.count(anchor) != 1:
        raise SystemExit("anchor-missing:" + MARK_BOTH + ":sidebar")
    dl = (
        "\t\t\t\t\t\t// " + MARK_BOTH + ": a copy on this computer too, beside the folder button (the phone's one\n"
        "\t\t\t\t\t\t// button already downloads).\n"
        "\t\t\t\t\t\t!showEmpty && !isDir && !companyIsPhone() && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"a\", {\n"
        "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
        "\t\t\t\t\t\t\thref: downloadUrl(scope, path),\n"
        "\t\t\t\t\t\t\tdownload: true,\n"
        "\t\t\t\t\t\t\t\"aria-label\": \"下载到本机\",\n"
        "\t\t\t\t\t\t\ttitle: \"下载到本机\",\n"
        "\t\t\t\t\t\t\tchildren: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 14 })\n"
        "\t\t\t\t\t\t}),\n"
    )
    return t.replace(anchor, dl + anchor, 1), "patched"


SIDEBAR_DL = (
    "\t\t\t\t\t\t!showEmpty && !isDir && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"a\", {\n"
    "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
    "\t\t\t\t\t\t\thref: downloadUrl(scope, path),\n"
    "\t\t\t\t\t\t\tdownload: true,\n"
    "\t\t\t\t\t\t\t\"aria-label\": \"下载到本机\",\n"
    "\t\t\t\t\t\t\ttitle: \"下载到本机\",\n"
    "\t\t\t\t\t\t\tchildren: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 14 })\n"
    "\t\t\t\t\t\t}),\n"
)


def patch_sidebar_reveal(t: str) -> tuple[str, str]:
    if MARK_REVEAL in t:
        return t, "already"
    new_btn = (
        "\t\t\t\t\t\t// " + MARK_REVEAL + ": show the open file in this computer's file manager; a desk without the relay\n"
        "\t\t\t\t\t\t// (its kernel on this computer, the phone) downloads it as before.\n"
        "\t\t\t\t\t\t!showEmpty && !isDir && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n"
        "\t\t\t\t\t\t\ttype: \"button\",\n"
        "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
        "\t\t\t\t\t\t\t\"aria-label\": companyIsPhone() ? \"下载到本机\" : \"在文件夹中显示\",\n"
        "\t\t\t\t\t\t\ttitle: companyIsPhone() ? \"下载到本机\" : \"在文件夹中显示\",\n"
        "\t\t\t\t\t\t\tonClick: () => { companyRevealOrDownload(path, downloadUrl(scope, path)); },\n"
        "\t\t\t\t\t\t\tchildren: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(companyIsPhone() ? _deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular : _deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular, { size: 14 })\n"
        "\t\t\t\t\t\t}),\n"
    )
    if t.count(SIDEBAR_DL) != 1:
        raise SystemExit("anchor-missing:" + MARK_REVEAL + ":sidebar-button")
    t = t.replace(SIDEBAR_DL, new_btn, 1)
    anchor = "\t\tfunction downloadUrl(scope, path) {\n"
    if t.count(anchor) != 1:
        raise SystemExit("anchor-missing:" + MARK_REVEAL + ":sidebar-helper")
    helper = REVEAL_HELPER + (
        "\t\tasync function companyRevealOrDownload(path, href) {\n"
        "\t\t\tif (!companyIsPhone() && await companyRevealLocal(path) !== \"none\") return;\n"
        "\t\t\tconst a = document.createElement(\"a\");\n"
        "\t\t\ta.href = href;\n"
        "\t\t\ta.download = \"\";\n"
        "\t\t\tdocument.body.appendChild(a);\n"
        "\t\t\ta.click();\n"
        "\t\t\ta.remove();\n"
        "\t\t}\n"
    )
    return t.replace(anchor, helper + anchor, 1), "patched"


def patch_sidebar_button(t: str) -> tuple[str, str]:
    old_btn = (
        "\t\t\t\t\t\ttoolbar !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n"
        "\t\t\t\t\t\t\ttype: \"button\",\n"
        "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
        "\t\t\t\t\t\t\t\"aria-label\": t(\"refresh\"),\n"
    )
    new_btn = (
        "\t\t\t\t\t\t// " + MARK_BUTTON + ": download any open file (images and videos too).\n"
        "\t\t\t\t\t\t!showEmpty && !isDir && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"a\", {\n"
        "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
        "\t\t\t\t\t\t\thref: downloadUrl(scope, path),\n"
        "\t\t\t\t\t\t\tdownload: true,\n"
        "\t\t\t\t\t\t\t\"aria-label\": \"下载到本机\",\n"
        "\t\t\t\t\t\t\ttitle: \"下载到本机\",\n"
        "\t\t\t\t\t\t\tchildren: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 14 })\n"
        "\t\t\t\t\t\t}),\n"
        + old_btn
    )
    return edit_text(t, MARK_BUTTON, old_btn, new_btn)


def patch_grok_media(t: str) -> tuple[str, str]:
    t, how = edit_text(t, MARK_MEDIA,
        "    writeFileSync(join(process.cwd(), rel), raw);\n    paths.push(rel.replace(/\\\\/g, \"/\"));\n",
        "    // " + MARK_MEDIA + ": hand back the absolute path, the same one preview,\n"
        "    // download and show-in-folder use, whatever workspace the session is in.\n"
        "    const abs = join(process.cwd(), rel);\n"
        "    writeFileSync(abs, raw);\n"
        "    paths.push(abs);\n")
    t = t.replace("Writes PNG/JPEG under artifacts/ and returns those workspace-relative paths.",
                  "Writes PNG/JPEG under artifacts/ and returns their absolute paths; present them so the person can preview and download.")
    t = t.replace("Writes MP4 under artifacts/. Optional image_path",
                  "Writes MP4 under artifacts/ and returns its absolute path; present it so the person can preview and download. Optional image_path")
    return t, how


CARD_HELPERS = """		// company-presented-inline-media-v1: inline image/video and a download link
		// for presented files, served by dsh-better-sidebar's /sidebar/file route.
		const COMPANY_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
		const COMPANY_VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);
		function companyMediaKind(path) {
			const ext = String(path).split(/[\\\\/]/).pop().split(".").pop().toLowerCase();
			return COMPANY_IMAGE_EXT.has(ext) ? "image" : COMPANY_VIDEO_EXT.has(ext) ? "video" : null;
		}
		function companyFileRoute(sessionId, cwd, path, download) {
			const params = new URLSearchParams({ sessionId: String(sessionId || ""), path });
			if (cwd) params.set("cwd", cwd);
			if (download) params.set("download", "1");
			return "/sidebar/file?" + params.toString();
		}
		function CompanyPresentedMedia({ sessionId, cwd, path, onPreview }) {
			const kind = companyMediaKind(path);
			if (kind === null) return null;
			const src = companyFileRoute(sessionId, cwd, path, false);
			const box = { display: "block", maxWidth: "100%", maxHeight: 360, borderRadius: 8, marginTop: 6, background: "#000" };
			if (kind === "image") return (0, react_jsx_runtime.jsx)("img", {
				src,
				alt: path,
				title: "点开查看大图",
				loading: "lazy",
				style: { ...box, background: "transparent", cursor: "zoom-in" },
				onClick: onPreview
			});
			return (0, react_jsx_runtime.jsx)("video", {
				src,
				controls: true,
				preload: "metadata",
				playsInline: true,
				style: box
			});
		}
		function CompanyDownloadLink({ sessionId, cwd, path }) {
			return (0, react_jsx_runtime.jsx)("a", {
				href: companyFileRoute(sessionId, cwd, path, true),
				download: true,
				title: "下载到本机",
				"aria-label": "下载到本机",
				"data-company-download": true,
				onClick: (event) => { event.stopPropagation(); },
				style: { position: "relative", zIndex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, marginRight: 4, borderRadius: 6, border: "1px solid var(--color-border-default, rgba(0,0,0,.15))", color: "inherit" },
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 16 })
			});
		}
"""


def patch_presented_card(t: str) -> tuple[str, str]:
    return chain(t, patch_presented_media, patch_presented_reveal, patch_presented_both)


def patch_presented_both(t: str) -> tuple[str, str]:
    if MARK_BOTH in t:
        return t, "already"
    old = "\t\t\tif (!companyIsPhone()) return null;\n"
    if MARK_REVEAL not in t:
        return t, "no-card"
    if t.count(old) != 1:
        raise SystemExit("anchor-missing:" + MARK_BOTH + ":card")
    return t.replace(old, "\t\t\t// " + MARK_BOTH + ": the download link on the computer too, beside the folder button.\n", 1), "patched"


def patch_presented_reveal(t: str) -> tuple[str, str]:
    if MARK_REVEAL in t:
        return t, "already"
    if "function CompanyDownloadLink(" not in t:
        return t, "no-card"
    steps = [
        # the download link only on the phone (no folder there)
        ("\t\tfunction CompanyDownloadLink({ sessionId, cwd, path }) {\n",
         REVEAL_HELPER + "\t\tfunction CompanyDownloadLink({ sessionId, cwd, path }) {\n"
         "\t\t\tif (!companyIsPhone()) return null;\n"),
        # the card's file path rides along with its reveal
        ("\t\t\t\t\t\t\t\tonAction: (action, application) => openPresented(sessionId, file.seq, file.index, action, application)\n",
         "\t\t\t\t\t\t\t\tonAction: (action, application) => openPresented(sessionId, file.seq, file.index, action, application, resolveWorkspacePath(cwd, file.path))\n"),
        ("\t\t\t\t\topenPresented: (sessionId, seq, index, action, application) => opener.open(sessionId, seq, index, action, application),\n",
         "\t\t\t\t\topenPresented: (sessionId, seq, index, action, application, localPath) => opener.open(sessionId, seq, index, action, application, localPath),\n"),
        ("\t\t\topen(sessionId, seq, index, action = \"open\", application) {\n"
         "\t\t\t\treturn this.openUrl(presentedFileUrl(sessionId, seq, index), action, application);\n",
         "\t\t\topen(sessionId, seq, index, action = \"open\", application, localPath) {\n"
         "\t\t\t\treturn this.openUrl(presentedFileUrl(sessionId, seq, index), action, application, localPath);\n"),
        ("\t\t\tasync openUrl(url, action, application) {\n",
         "\t\t\tasync openUrl(url, action, application, localPath) {\n"),
        ("\t\t\t\tconst task = this.request(url, action, application);\n",
         "\t\t\t\tconst task = this.request(url, action, application, localPath);\n"),
        ("\t\t\tasync request(url, action, application) {\n",
         "\t\t\tasync request(url, action, application, localPath) {\n"),
        ("\t\t\t\t\tconst target = action === \"reveal\" ? `${url}&action=reveal` : application === void 0 ? url : `${url}&application=${encodeURIComponent(application)}`;\n"
         "\t\t\t\t\tconst response = await fetch(target, {\n"
         "\t\t\t\t\t\tmethod: \"POST\",\n"
         "\t\t\t\t\t\tsignal: this.lifetime.signal\n"
         "\t\t\t\t\t});\n"
         "\t\t\t\t\tif (!response.ok) phase = response.status === 422 ? \"nativeUnavailable\" : failure;\n",
         "\t\t\t\t\t// " + MARK_REVEAL + ": this computer's relay shows it here; without one the kernel does, as before.\n"
         "\t\t\t\t\tconst companyLocal = action === \"reveal\" && localPath ? await companyRevealLocal(localPath) : \"none\";\n"
         "\t\t\t\t\tif (companyLocal === \"fail\") phase = failure;\n"
         "\t\t\t\t\telse if (companyLocal === \"none\") {\n"
         "\t\t\t\t\t\tconst target = action === \"reveal\" ? `${url}&action=reveal` : application === void 0 ? url : `${url}&application=${encodeURIComponent(application)}`;\n"
         "\t\t\t\t\t\tconst response = await fetch(target, {\n"
         "\t\t\t\t\t\t\tmethod: \"POST\",\n"
         "\t\t\t\t\t\t\tsignal: this.lifetime.signal\n"
         "\t\t\t\t\t\t});\n"
         "\t\t\t\t\t\tif (!response.ok) phase = response.status === 422 ? \"nativeUnavailable\" : failure;\n"
         "\t\t\t\t\t}\n"),
    ]
    for old, new in steps:
        if t.count(old) != 1:
            raise SystemExit("anchor-missing:" + MARK_REVEAL + ":" + old[:60].replace("\n", "|"))
        t = t.replace(old, new, 1)
    return t, "patched"


def patch_presented_media(t: str) -> tuple[str, str]:
    if MARK_CARD in t:
        return edit_text(t, MARK_ASPECT, BOX_V1, BOX_V2)
    steps = [
        ("\t\tfunction PresentedFileCard({ file, cwd, phase, host, onPreview, actions, t }) {\n",
         CARD_HELPERS + "\t\tfunction PresentedFileCard({ file, cwd, phase, host, onPreview, actions, t, sessionId }) {\n"
         "\t\t\tconst companyPath = resolveWorkspacePath(cwd, file.path);\n"),
        ("\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(\"div\", {\n"
         "\t\t\t\t\t\t\tclassName: Deliverables_module_css_default.actions,\n"
         "\t\t\t\t\t\t\tchildren: actions\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t}\n",
         "\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\t\t\t\tclassName: Deliverables_module_css_default.actions,\n"
         "\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(CompanyDownloadLink, { sessionId, cwd, path: companyPath }), actions]\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t}\n"),
        ("\t\t\treturn (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\tclassName: Deliverables_module_css_default.file,\n"
         "\t\t\t\t\"data-presented-file\": true,\n",
         "\t\t\tconst companyCard = (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\tclassName: Deliverables_module_css_default.file,\n"
         "\t\t\t\t\"data-presented-file\": true,\n"),
        ("\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(CompanyDownloadLink, { sessionId, cwd, path: companyPath }), actions]\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t}\n",
         "\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(CompanyDownloadLink, { sessionId, cwd, path: companyPath }), actions]\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t\tif (companyMediaKind(companyPath) === null) return companyCard;\n"
         "\t\t\treturn (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\t\"data-company-presented-media\": true,\n"
         "\t\t\t\tstyle: { display: \"flex\", flexDirection: \"column\", minWidth: 0 },\n"
         "\t\t\t\tchildren: [companyCard, (0, react_jsx_runtime.jsx)(CompanyPresentedMedia, { sessionId, cwd, path: companyPath, onPreview })]\n"
         "\t\t\t});\n"
         "\t\t}\n"),
        ("\t\t\t\t\t\tchildren: presented.map((file) => (0, react_jsx_runtime.jsx)(PresentedFileCard, {\n"
         "\t\t\t\t\t\t\tfile,\n"
         "\t\t\t\t\t\t\tcwd,\n",
         "\t\t\t\t\t\tchildren: presented.map((file) => (0, react_jsx_runtime.jsx)(PresentedFileCard, {\n"
         "\t\t\t\t\t\t\tfile,\n"
         "\t\t\t\t\t\t\tcwd,\n"
         "\t\t\t\t\t\t\tsessionId,\n"),
    ]
    for old, new in steps:
        if t.count(old) != 1:
            raise SystemExit("card-anchor-missing:" + old[:60].replace("\n", "|"))
        t = t.replace(old, new, 1)
    return edit_text(t, MARK_ASPECT, BOX_V1, BOX_V2)


# rel 后缀 -> 补丁函数（rel 是相对 CompanyDesk/ 的路径）
TARGETS = (
    ("dsh-better-sidebar/lib/index.js", patch_sidebar_index),
    ("dsh-better-sidebar/lib/client.js", patch_sidebar_client),
    ("company-grok-media/lib/index.js", patch_grok_media),
    ("@deepseek-ai/dsh-client-ui-deliverables/lib/client.js", patch_presented_card),
)


def for_member(rel: str):
    for suffix, fn in TARGETS:
        if rel.endswith(suffix):
            return fn
    return None


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        fn = for_member(p.as_posix())
        if fn is None:
            print(a, "no-target")
            continue
        raw = p.read_text(encoding="utf-8")
        crlf = "\r\n" in raw
        t, how = fn(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
