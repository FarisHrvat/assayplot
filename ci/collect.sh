#!/usr/bin/env bash
#
# Gathers the installers a Tauri build produced into out/, with checksums.
#
#   bash ci/collect.sh x86_64-unknown-linux-gnu
#
# Tauri scatters them across bundle/<format>/, and the paths differ per target
# and per format. Finding them is more reliable than listing them.

set -euo pipefail

TARGET="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/src-tauri/target/${TARGET:+$TARGET/}release/bundle"

if [[ ! -d "$BUNDLE" ]]; then
  echo "error: no bundle directory at $BUNDLE" >&2
  exit 1
fi

# Start clean, or a stale installer from an earlier build tags along.
rm -rf "$ROOT/out"
mkdir -p "$ROOT/out"
find "$BUNDLE" -type f \( \
  -name '*.dmg' -o -name '*.AppImage' -o -name '*.deb' -o \
  -name '*.rpm' -o -name '*.msi' -o -name '*-setup.exe' \
\) -exec cp {} "$ROOT/out/" \;

# Tauri's bundlers each follow their own packaging convention, so the files
# come out as AssayPlot-0.7.1-1.x86_64.rpm next to AssayPlot_0.7.1_amd64.deb.
# Nobody downloading can tell which one is for their machine. Rename them to
# say the machine and, for Linux, the distributions the package suits.
cd "$ROOT/out"
VERSION="$(node -p "require('$ROOT/package.json').version")"

rename_to() {
  local from="$1" to="$2"
  [[ -e "$from" && "$from" != "$to" ]] && mv -f "$from" "$to"
  return 0
}

shopt -s nullglob
for f in *; do
  case "$f" in
    *.dmg|SHA256SUMS.txt) ;;                         # already named by make-dmg.sh
    *-setup.exe) rename_to "$f" "AssayPlot_${VERSION}_Windows_x64_setup.exe" ;;
    *.msi)       rename_to "$f" "AssayPlot_${VERSION}_Windows_x64.msi" ;;
    *.AppImage)  rename_to "$f" "AssayPlot_${VERSION}_Linux_x64.AppImage" ;;
    *.deb)       rename_to "$f" "AssayPlot_${VERSION}_Linux_Debian-Ubuntu_x64.deb" ;;
    *.rpm)       rename_to "$f" "AssayPlot_${VERSION}_Linux_Fedora-RHEL_x64.rpm" ;;
  esac
done

files=(*)
# The checksum file is written here; it must not be one of its own inputs.
files=("${files[@]/SHA256SUMS.txt}")
if (( ${#files[@]} == 0 )); then
  echo "error: the build produced no installers" >&2
  exit 1
fi

if command -v sha256sum >/dev/null; then
  sha256sum "${files[@]}" > SHA256SUMS.txt
else
  shasum -a 256 "${files[@]}" > SHA256SUMS.txt
fi

echo "Collected:"
cat SHA256SUMS.txt
