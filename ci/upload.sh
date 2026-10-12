#!/usr/bin/env bash
# Puts the installers in out/ into the project's package registry, under the
# tag's version. Does nothing for builds that aren't a release.
set -euo pipefail

if [ -z "${CI_COMMIT_TAG:-}" ]; then
  echo "Not a release, keeping the installers as job artifacts only."
  exit 0
fi

version="${CI_COMMIT_TAG#v}"
for file in out/*; do
  name=$(basename "$file")
  [ "$name" = SHA256SUMS.txt ] && continue
  curl --fail --silent --show-error --header "JOB-TOKEN: $CI_JOB_TOKEN" --upload-file "$file" \
    "$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/assayplot/$version/$name" > /dev/null
  echo "uploaded $name"
done
