#!/usr/bin/env bash
# Tauri 2.12 packs apprun-hooks as 0700, so the AppImage doesn't start in
# sandboxes like firejail or for other users. Rebuild its squashfs with normal
# permissions and put it back behind the original runtime.
set -euo pipefail

target="$1"
appimage=$(find "src-tauri/target/$target/release/bundle/appimage" -name '*.AppImage' | head -n 1)
if [ -z "$appimage" ]; then
  echo "No AppImage found for $target" >&2
  exit 1
fi
appimage=$(realpath "$appimage")

work=$(mktemp -d)
chmod +x "$appimage"
offset=$("$appimage" --appimage-offset)
head -c "$offset" "$appimage" > "$work/runtime"
unsquashfs -q -o "$offset" -d "$work/root" "$appimage" >/dev/null

chmod -R u+rwX,go+rX,go-w "$work/root"
mksquashfs "$work/root" "$work/fs.squashfs" -root-owned -noappend -no-xattrs \
  -comp zstd -b 131072 -quiet

cat "$work/runtime" "$work/fs.squashfs" > "$appimage"
chmod +x "$appimage"
rm -rf "$work"
echo "Repacked $(basename "$appimage")"
