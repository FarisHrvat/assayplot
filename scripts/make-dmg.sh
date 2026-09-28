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

# An optional Rust target triple, for cross-architecture builds. Without one,
# Tauri writes to target/release; with one it writes to target/<triple>/release.
TARGET="${1:-}"
if [[ -n "$TARGET" ]]; then
  BUNDLE="$ROOT/src-tauri/target/$TARGET/release/bundle"
  case "$TARGET" in
    aarch64-*) ARCH="AppleSilicon_aarch64" ;;
    x86_64-*)  ARCH="Intel_x64" ;;
    *)         ARCH="$TARGET" ;;
  esac
else
  BUNDLE="$ROOT/src-tauri/target/release/bundle"
  case "$(uname -m)" in
    arm64)  ARCH="AppleSilicon_aarch64" ;;
    x86_64) ARCH="Intel_x64" ;;
    *)      ARCH="$(uname -m)" ;;
  esac
fi
APP="$BUNDLE/macos/AssayPlot.app"

if [[ ! -d "$APP" ]]; then
  echo "error: $APP not found. Run 'npm run desktop:build' first." >&2
  exit 1
fi

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
OUT="$BUNDLE/dmg/AssayPlot_${VERSION}_macOS_${ARCH}.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Staging AssayPlot ${VERSION} (${ARCH})"
mkdir -p "$BUNDLE/dmg"
cp -R "$APP" "$STAGE/"

# Without an identity Tauri skips codesign and macOS calls the app damaged
# ("code has no resources but signature indicates they must be present").
# An ad-hoc seal gets the normal unidentified-developer prompt instead.
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Ad-hoc signing (no Developer ID set)"
  codesign --force --deep --sign - "$STAGE/AssayPlot.app"
  codesign --verify --deep --strict "$STAGE/AssayPlot.app"
fi
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
