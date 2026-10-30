#!/usr/bin/env bash
# Fetches the leptris-wasm bundle from the leptris-rs release that the
# engine tier pinned, and unpacks it into vendor/leptris-wasm/. The
# pin lives here (single line) so a train bump is a one-line diff.
set -euo pipefail

LEPTRIS_RS_RELEASE="${LEPTRIS_RS_RELEASE:-leptris-v1.5.0}"
here="$(cd "$(dirname "$0")/.." && pwd)"
target="$here/vendor/leptris-wasm"

if [ -f "$target/.pin" ] && [ "$(cat "$target/.pin")" = "$LEPTRIS_RS_RELEASE" ]; then
  echo "vendor/leptris-wasm already at $LEPTRIS_RS_RELEASE"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gh release download "$LEPTRIS_RS_RELEASE" --repo leptris/leptris-rs \
  --pattern '*.tgz' --output "$work/bundle.tgz"
mkdir -p "$target"
tar xzf "$work/bundle.tgz" -C "$target"
printf '%s\n' "$LEPTRIS_RS_RELEASE" > "$target/.pin"
echo "vendor/leptris-wasm fetched at $LEPTRIS_RS_RELEASE"
