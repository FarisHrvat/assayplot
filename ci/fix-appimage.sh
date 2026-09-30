#!/usr/bin/env bash
# Tauri 2.12 packs apprun-hooks as 0700, so the AppImage doesn't start in
# sandboxes like firejail or for other users. Repack it with the same runtime
# and normal permissions.
set -euo pipefail

target="$1"
appimage=$(find "src-tauri/target/$target/release/bundle/appimage" -name '*.AppImage' | head -n 1)
if [ -z "$appimage" ]; then
  echo "No AppImage found for $target" >&2
  exit 1
fi
appimage=$(realpath "$appimage")

work=$(mktemp -d)
cd "$work"
cp "$appimage" app.AppImage
chmod +x app.AppImage
./app.AppImage --appimage-extract >/dev/null
offset=$(./app.AppImage --appimage-offset)
head -c "$offset" app.AppImage > runtime

chmod -R u+rwX,go+rX,go-w squashfs-root

curl -fsSL -o appimagetool \
  https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage
chmod +x appimagetool
ARCH=x86_64 ./appimagetool --appimage-extract-and-run --no-appstream \
  --runtime-file runtime squashfs-root fixed.AppImage

cp fixed.AppImage "$appimage"
chmod +x "$appimage"
cd /
rm -rf "$work"
echo "Repacked $(basename "$appimage")"
