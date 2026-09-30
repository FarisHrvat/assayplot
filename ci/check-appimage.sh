#!/usr/bin/env bash
# Fails if a file in the AppImage can't be read or run by every user.
# Tauri 2.11 shipped AppRun.wrapped as 0770, so the app didn't start in
# sandboxes like firejail or for users other than the owner.
set -euo pipefail

target="$1"
appimage=$(find "src-tauri/target/$target/release/bundle/appimage" -name '*.AppImage' | head -n 1)
if [ -z "$appimage" ]; then
  echo "No AppImage found for $target" >&2
  exit 1
fi

work=$(mktemp -d)
cp "$appimage" "$work/app.AppImage"
chmod +x "$work/app.AppImage"
(cd "$work" && ./app.AppImage --appimage-extract >/dev/null)

bad=$(find "$work/squashfs-root" \( -type f -o -type d \) \
  \( ! -perm -o=r -o \( -perm -u=x ! -perm -o=x \) \) -printf '%m %P\n')
rm -rf "$work"

if [ -n "$bad" ]; then
  echo "These files in $(basename "$appimage") are not readable or runnable by everyone:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "$(basename "$appimage"): permissions ok"
