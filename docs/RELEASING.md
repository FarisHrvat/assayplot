# Releasing AssayPlot

## Before a release

```bash
npm ci
npm run licenses     # no runtime dependency outside the allow-list
npm run typecheck
npm test             # 165 tests, 36 checked against R
npm run build
npm run examples     # regenerate the worked projects
```

If R is installed, also confirm the fixtures still match the oracle:

```bash
Rscript validation/generate/reference.R
git diff --exit-code validation/fixtures/    # must be empty
```

A non-empty diff means either a regression or that R itself has changed. Find out
which before releasing. Never commit a hand-edited fixture.

## Version numbers

Three files must agree, or the built app reports the wrong version:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src/app/model.ts` → `APP_VERSION`, which is what appears in methods sentences
  and saved projects

## Building

```bash
npm run desktop:dmg                # macOS: app + DMG, verified to mount
npm run desktop:build:installers   # Linux and Windows
```

macOS is packaged by `scripts/make-dmg.sh` rather than Tauri's own DMG step.
Tauri's shells out to `bundle_dmg.sh`, which drives Finder over AppleScript and
fails with `AppleEvent timed out (-1712)` on any machine without a logged-in
desktop session — including every CI runner.

## Signing — currently outstanding

**Builds are unsigned.** macOS Gatekeeper and Windows SmartScreen both warn on
first launch, and unsigned scientific software gets abandoned at that dialog.
This is the main thing standing between the current alpha and a 1.0 that labs
can be asked to install.

Neither can be automated away: both require the project owner's legal identity
and payment.

### macOS

1. Enrol in the Apple Developer Program (~$99/year).
2. Create a **Developer ID Application** certificate and install it in the login
   keychain.
3. Create an app-specific password for notarisation.
4. Set, in the release environment:
   ```
   APPLE_SIGNING_IDENTITY="Developer ID Application: NAME (TEAMID)"
   APPLE_ID=...
   APPLE_PASSWORD=...          # the app-specific password
   APPLE_TEAM_ID=...
   ```
5. Add to `src-tauri/tauri.conf.json` under `bundle.macOS`:
   ```json
   "signingIdentity": "-",
   "hardenedRuntime": true
   ```
6. Tauri signs and notarises during `tauri build` once those are present. Verify
   with `spctl -a -vvv -t install /path/to/AssayPlot.app`, which should report
   *accepted, source=Notarized Developer ID*.

### Windows

1. Obtain an OV or EV code-signing certificate. Issuance takes weeks and, since
   2023, requires hardware-backed key storage (a token or a cloud HSM).
2. Configure `bundle.windows.certificateThumbprint` and `digestAlgorithm` in
   `tauri.conf.json`, or sign the built `.msi` with `signtool`.

An EV certificate builds SmartScreen reputation immediately; an OV one accrues
it over time and downloads, so early users will still see the warning.

### Linux

AppImage and `.deb` are unsigned by convention. Publish SHA-256 checksums beside
the artefacts.

## Cutting the release

```bash
git tag -a v0.3.0 -m "AssayPlot 0.3.0"
git push origin v0.3.0
```

CI builds macOS, Linux and Windows and attaches the artefacts. Publish checksums
with them.

## Release notes

State plainly:

- Anything that changes a **number**. If a statistical fix alters results,
  say which procedures and by how much, so anyone who has already published can
  check. This matters more than any feature.
- New analyses and plot types.
- Whether the build is signed.
- Any change to the project file format, and whether older projects still open.
