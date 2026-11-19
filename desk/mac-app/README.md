# Mac app shell (company-mac-app-v1)

What the Mac download wraps around each publish's pack. `server/publish-site-update.ps1` (step 4b)
runs `site-cs.py mac-app-zip`, which writes `TDHarness-mac.zip`: a `TDHarness/` folder holding
`TDHarness.app`, a link to `/Applications` and a short note, so a person drags the app in.

- `TDHarness`: the desk shell (Swift, WKWebView; opens the login window, starts the desk from
  `Contents/Resources/start.command`, shows its progress). Universal (arm64 + x86_64), built from
  `src/CompanyDesk.release.swift`:

      for a in arm64 x86_64; do swiftc -O -target ${a}-apple-macosx12.0 -framework Cocoa -framework WebKit -o TD-$a src/CompanyDesk.release.swift; done
      lipo -create -output TDHarness TD-arm64 TD-x86_64

  Keep the linker's own ad-hoc signature (`flags=0x20002(adhoc,linker-signed)`): do not run
  `codesign` on it. A full ad-hoc signature expects a sealed bundle, and the bundle is put together
  on the Windows server, so macOS would call the app damaged. With the linker's signature the app is
  simply unsigned: on first open the person allows it once in 系统设置 → 隐私与安全性 → 仍要打开.
  Without a prompt at all needs an Apple Developer ID and notarization.
- `Info.plist`, `AppIcon.icns` (made from `server/tdharness.ico`).
- `src/`: the shell's source as it came from the earlier client repository (dsh-saas
  `scripts/p-client-app/mac/`); `CompanyDesk.swift` and `build-mac.sh` are the older thin client,
  kept for reference.

Proof: `python3 scripts/prove-mac-app-zip.py`.
