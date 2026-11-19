window.__ModuleLoader__.load({
	id: "company-no-add-key",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const inject = ["slots"];

		// Additive CSS only. Do not register on settings.onboarding: that
		// coordinator shows one step at a time, and a null render that never
		// complete()s freezes welcome-notice / composer.
		// company-no-add-key-v2: these rules said display: inline-block since 2026.10.11, so the
		// official key box showed, and a DeepSeek key typed into it was kept on that desk
		// (DEEPSEEK_OFFICIAL_KEY in .credentials.yaml) where nothing reads it: the company
		// gateway never got it and no DeepSeek model appeared. Hide them; the company's own
		// boxes (the server-side 加入模型 key, the people page's first password) stay.
		const KEEP = ':not([data-company-key]):not(.cs-input)';
		// company-no-add-key-v3: the kernel's own provider list on Settings > 模型 (its 「DeepSeek
		// deepseek-official」 card with the key box hidden, and the 「公司模型」 card whose 删除 would cut
		// the desk off the gateway) goes too. Keys and models are set in the company panel above it
		// (服务器模型密钥 / 开放给大家的模型). zGbnIq_ is that settings module's CSS prefix; a kernel
		// bump that renames it only shows the list again.
		const KERNEL_MODELS = ["title", "intro", "notice", "savedNotice", "rows", "addBlock"]
			.map(function (k) { return '[data-slot="settings.section"] .zGbnIq_' + k; }).join(",\n");
		const CSS = [
			'[data-slot="settings.section"] input[type="password"]' + KEEP + ',',
			'[data-slot="settings.section"] input[autocomplete="new-password"]' + KEEP + ',',
			'[data-slot="settings.section"] input[autocomplete="current-password"]' + KEEP + ',',
			'[data-slot="settings.onboarding"] input[type="password"]' + KEEP + ',',
			KERNEL_MODELS + ' { display: none !important; }'
		].join("\n");

		function HideOfficialKeyFields() {
			return React.createElement("style", null, CSS);
		}

		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", function () {
				return ctx.slots.register({
					name: "sidebar.footer.action",
					id: "company-no-add-key",
					order: 60
				}, HideOfficialKeyFields);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
