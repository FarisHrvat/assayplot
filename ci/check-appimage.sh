#!/usr/bin/env bash
# Fails if a file in the AppImage can't be read or run by every user, which
# stops it from starting in sandboxes like firejail or for other users.
set -euo pipefail

target="$1"
appimage=$(find "src-tauri/target/$target/release/bundle/appimage" -name '*.AppImage' | head -n 1)
if [ -z "$appimage" ]; then
  echo "No AppImage found for $target" >&2
  exit 1
fi

chmod +x "$appimage"
offset=$("$appimage" --appimage-offset)
bad=$(unsquashfs -lln -o "$offset" "$appimage" | awk '
  $1 ~ /^[-d]/ {
    mode = $1
    others = substr(mode, 8, 3)
    runnable = substr(mode, 1, 1) == "d" || substr(mode, 4, 1) == "x"
    if (substr(others, 1, 1) != "r" || (runnable && substr(others, 3, 1) != "x"))
      print mode, $NF
  }')

if [ -n "$bad" ]; then
  echo "These files in $(basename "$appimage") are not readable or runnable by everyone:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "$(basename "$appimage"): permissions ok"
