#!/usr/bin/env bash
# Makes the GitLab release for the version in package.json: builds both macOS
# versions here, takes the Linux installers CI built for the tag, and publishes
# all of them with checksums. Needs glab signed in, and the tag's "linux" job
# finished.
#
#   bash ci/gitlab-release.sh notes.md
set -euo pipefail

NOTES="$(cd "$(dirname "${1:?usage: ci/gitlab-release.sh notes.md}")" && pwd)/$(basename "$1")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="FarisHrvat/assayplot"
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
TAG="v$VERSION"
WORK="$(mktemp -d)"
cd "$ROOT"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "Tag $TAG does not exist." >&2; exit 1; }

echo "Linux installers from CI"
(cd "$WORK" && glab job artifact "$TAG" linux -R "$REPO" >/dev/null)
mv "$WORK"/out/* "$WORK"/ && rm -rf "$WORK/out" "$WORK/SHA256SUMS.txt"

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  echo "macOS $target"
  npx tauri build --target "$target" --bundles app
  bash scripts/make-dmg.sh "$target"
  cp src-tauri/target/"$target"/release/bundle/dmg/AssayPlot_"$VERSION"_macOS_*.dmg "$WORK"/
done

cd "$WORK"
shasum -a 256 *.dmg *.AppImage *.deb *.rpm > SHA256SUMS.txt

package="https://gitlab.com/api/v4/projects/${REPO/\//%2F}/packages/generic/assayplot/$VERSION"
links="["
for file in *.AppImage *.deb *.rpm; do
  links+="{\"name\":\"$file\",\"url\":\"$package/$file\",\"link_type\":\"package\"},"
done
links="${links%,}]"

cat "$NOTES" - > notes.md <<'EOF'

## Which file

| Your machine | File |
|---|---|
| Mac with Apple Silicon (M1 and later) | `macOS_AppleSilicon_aarch64.dmg` |
| Mac with an Intel processor | `macOS_Intel_x64.dmg` |
| Debian, Ubuntu, Mint | `Linux_Debian-Ubuntu_x64.deb` |
| Fedora, RHEL, openSUSE | `Linux_Fedora-RHEL_x64.rpm` |
| Any other Linux | `Linux_x64.AppImage` |

Windows builds are coming back soon.

## Opening it the first time

The builds aren't signed yet, so the first launch gets blocked.

- **macOS**: System Settings, Privacy & Security, scroll down, Open Anyway.
- **Linux**: `chmod +x` the AppImage, or install the `.deb` or `.rpm`.

Check a download with `shasum -a 256 -c SHA256SUMS.txt`.
EOF

glab release create "$TAG" *.dmg SHA256SUMS.txt -R "$REPO" \
  --use-package-registry --package-name assayplot \
  --name "AssayPlot $TAG" --notes-file notes.md --assets-links "$links"

rm -rf "$WORK"
