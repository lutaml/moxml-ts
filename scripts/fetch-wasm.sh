#!/usr/bin/env bash
# Fetches the pinned wasm bundles and the conformance dataset:
#   engine tier  — leptris-wasm from the leptris-rs release
#   model tier   — moxml-wasm  from the moxml-rs release (the pure-logic
#                  model faces; one implementation, bound per language)
# plus test/data/moxml-conformance.json at the moxml-rs pin.
# The pins live here (one line each) so a train bump is a one-line diff.
set -euo pipefail

LEPTRIS_RS_RELEASE="${LEPTRIS_RS_RELEASE:-leptris-v1.6.1}"
MOXML_RS_RELEASE="${MOXML_RS_RELEASE:-v0.1.1}"

here="$(cd "$(dirname "$0")/.." && pwd)"

fetch_bundle() { # repo release pattern target
  local repo="$1" release="$2" pattern="$3" target="$4"
  if [ -f "$target/.pin" ] && [ "$(cat "$target/.pin")" = "$release" ]; then
    echo "vendor/${target##*/vendor/} already at $release"
    return 0
  fi
  local work
  work="$(mktemp -d)"
  gh release download "$release" --repo "$repo" --pattern "$pattern" \
    --output "$work/bundle.tgz"
  mkdir -p "$target"
  tar xzf "$work/bundle.tgz" -C "$target"
  printf '%s\n' "$release" > "$target/.pin"
  rm -rf "$work"
  echo "vendor/${target##*/vendor/} fetched at $release"
}

fetch_bundle leptris/leptris-rs "$LEPTRIS_RS_RELEASE" '*.tgz' \
  "$here/vendor/leptris-wasm"
fetch_bundle lutaml/moxml-rs "$MOXML_RS_RELEASE" 'moxml-wasm-*.tgz' \
  "$here/vendor/moxml-wasm"

dataset="$here/test/data/moxml-conformance.json"
dataset_pin="$here/test/data/.pin"
if [ ! -f "$dataset_pin" ] || [ "$(cat "$dataset_pin")" != "$MOXML_RS_RELEASE" ]; then
  mkdir -p "$(dirname "$dataset")"
  gh api "repos/lutaml/moxml-rs/contents/tests/data/moxml-conformance.json?ref=$MOXML_RS_RELEASE" \
    -H "Accept: application/vnd.github.raw" > "$dataset"
  printf '%s\n' "$MOXML_RS_RELEASE" > "$dataset_pin"
  echo "test/data/moxml-conformance.json fetched at $MOXML_RS_RELEASE"
fi
