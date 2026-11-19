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
		const CSS = [
			'[data-slot="settings.section"] input[type="password"]' + KEEP + ',',
			'[data-slot="settings.section"] input[autocomplete="new-password"]' + KEEP + ',',
			'[data-slot="settings.section"] input[autocomplete="current-password"]' + KEEP + ',',
			'[data-slot="settings.onboarding"] input[type="password"]' + KEEP + ' { display: none !important; }'
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
