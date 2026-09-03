#!/usr/bin/env bash
#
# Packages the built macOS app into a DMG, headlessly.
#
#   npm run desktop:dmg
#
# Tauri's own DMG step shells out to bundle_dmg.sh, which drives Finder over
# AppleScript to lay out the disk-image window. That needs a logged-in desktop
# session and fails with "AppleEvent timed out (-1712)" on a build machine, in
# CI, or over SSH. The window decoration is cosmetic, so this builds the image
# with hdiutil alone: same installer, no GUI dependency.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/src-tauri/target/release/bundle"
APP="$BUNDLE/macos/AssayPlot.app"

if [[ ! -d "$APP" ]]; then
  echo "error: $APP not found. Run 'npm run desktop:build' first." >&2
  exit 1
fi

VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="$(uname -m)"
OUT="$BUNDLE/dmg/AssayPlot_${VERSION}_${ARCH}.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Staging AssayPlot ${VERSION} (${ARCH})"
mkdir -p "$BUNDLE/dmg"
cp -R "$APP" "$STAGE/"
# The drag-to-install target. Without Finder scripting this is a plain symlink,
# which is exactly what the fancy version creates anyway.
ln -s /Applications "$STAGE/Applications"

rm -f "$OUT"
hdiutil create \
  -volname "AssayPlot ${VERSION}" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$OUT" >/dev/null

SIZE="$(du -h "$OUT" | cut -f1 | tr -d ' ')"
echo "Wrote $OUT ($SIZE)"

# Verify the image actually mounts and contains a launchable app, because a
# corrupt DMG that only fails on the user's machine is the worst outcome here.
MOUNT="$(mktemp -d)"
hdiutil attach "$OUT" -mountpoint "$MOUNT" -nobrowse -quiet
if [[ -x "$MOUNT/AssayPlot.app/Contents/MacOS/assayplot" ]]; then
  echo "Verified: the image mounts and AssayPlot.app is executable."
  STATUS=0
else
  echo "error: the mounted image does not contain a launchable AssayPlot.app" >&2
  STATUS=1
fi
hdiutil detach "$MOUNT" -quiet
rmdir "$MOUNT" 2>/dev/null || true
exit $STATUS
