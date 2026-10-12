#!/usr/bin/env bash
# Creates the GitLab release for the tag from the installers the build jobs
# left in out/, with checksums. The tag's message is the "what changed" part.
set -euo pipefail

version="${CI_COMMIT_TAG#v}"
package="$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/assayplot/$version"

cd out
rm -f SHA256SUMS.txt
sha256sum AssayPlot_* > SHA256SUMS.txt
curl --fail --silent --show-error --header "JOB-TOKEN: $CI_JOB_TOKEN" \
  --upload-file SHA256SUMS.txt "$package/SHA256SUMS.txt" > /dev/null

links=""
for file in AssayPlot_* SHA256SUMS.txt; do
  links+="{\"name\":\"$file\",\"url\":\"$package/$file\",\"link_type\":\"package\"},"
done

notes="${CI_COMMIT_TAG_MESSAGE:-AssayPlot $CI_COMMIT_TAG}"
notes+="

## Which file

| Your machine | File |
|---|---|
| Mac with Apple Silicon (M1 and later) | \`macOS_AppleSilicon_aarch64.dmg\` |
| Mac with an Intel processor | \`macOS_Intel_x64.dmg\` |
| Windows | \`Windows_x64-setup.exe\` |
| Debian, Ubuntu, Mint | \`Linux_Debian-Ubuntu_x64.deb\` |
| Fedora, RHEL, openSUSE | \`Linux_Fedora-RHEL_x64.rpm\` |
| Any other Linux | \`Linux_x64.AppImage\` |

## Opening it the first time

The builds aren't signed yet, so the first launch gets blocked.

- **macOS**: System Settings, Privacy & Security, scroll down, Open Anyway.
- **Windows**: at the SmartScreen warning, More info, then Run anyway.
- **Linux**: \`chmod +x\` the AppImage, or install the \`.deb\` or \`.rpm\`.

Check a download with \`sha256sum -c SHA256SUMS.txt\`."

body=$(jq -n --arg tag "$CI_COMMIT_TAG" --arg name "AssayPlot $CI_COMMIT_TAG" --arg notes "$notes" \
  --argjson links "[${links%,}]" \
  '{tag_name: $tag, name: $name, description: $notes, assets: {links: $links}}')

curl --fail --silent --show-error --header "JOB-TOKEN: $CI_JOB_TOKEN" \
  --header "Content-Type: application/json" --data "$body" \
  "$CI_API_V4_URL/projects/$CI_PROJECT_ID/releases" > /dev/null
echo "Released $CI_COMMIT_TAG with: $(ls AssayPlot_* | tr '\n' ' ')"
