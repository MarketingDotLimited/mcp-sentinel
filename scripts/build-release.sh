#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Release bundles require a clean Git worktree.' >&2
  exit 1
fi

version="$(node -p "require('./package.json').version")"
source_ref="${MCP_RELEASE_SOURCE_REF:-HEAD}"
commit="$(git rev-parse --verify "${source_ref}^{commit}")"
tag_version="$(git describe --tags --exact-match "$commit" 2>/dev/null || true)"
if [[ -n "$tag_version" && "$tag_version" != "v${version}" ]]; then
  echo "Release tag ${tag_version} does not match package version v${version}." >&2
  exit 1
fi

output_root="${MCP_RELEASE_OUTPUT_DIR:-$repository_root/dist}"
mkdir -p "$output_root"
artifact="$output_root/mcp-sentinel-${version}.tar.gz"
checksum="$artifact.sha256"

git archive --format=tar --prefix="mcp-sentinel-${version}/" "$commit" | gzip -n -9 >"$artifact"
(
  cd "$output_root"
  sha256sum "$(basename "$artifact")" >"$(basename "$checksum")"
)

if [[ -n "${MCP_RELEASE_SIGNING_KEY:-}" ]]; then
  gpg --batch --yes --armor --local-user "$MCP_RELEASE_SIGNING_KEY" --detach-sign "$artifact"
  gpg --batch --verify "$artifact.asc" "$artifact"
elif [[ "${MCP_ALLOW_UNSIGNED_RELEASE:-false}" != 'true' ]]; then
  echo 'MCP_RELEASE_SIGNING_KEY is required (or explicitly set MCP_ALLOW_UNSIGNED_RELEASE=true for CI verification).' >&2
  exit 1
fi

printf '{"version":"%s","commit":"%s","artifact":"%s","sha256":"%s","signed":%s}\n' \
  "$version" \
  "$commit" \
  "$(basename "$artifact")" \
  "$(cut -d' ' -f1 "$checksum")" \
  "$([[ -f "$artifact.asc" ]] && printf true || printf false)"
