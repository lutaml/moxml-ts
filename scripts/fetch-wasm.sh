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

# Public release assets are fetched with curl, so a plain `npm install`
# (including a git dependency) needs no `gh` and no token.
fetch_bundle() { # repo release asset target
  local repo="$1" release="$2" asset="$3" target="$4"
  if [ -f "$target/.pin" ] && [ "$(cat "$target/.pin")" = "$release" ]; then
    rm -f "$target/.gitignore"
    echo "vendor/${target##*/vendor/} already at $release"
    return 0
  fi
  local work
  work="$(mktemp -d)"
  curl -fsSL -o "$work/bundle.tgz" \
    "https://github.com/$repo/releases/download/$release/$asset"
  mkdir -p "$target"
  tar xzf "$work/bundle.tgz" -C "$target"
  # The bundles ship a `.gitignore` of `*`; left in place it makes
  # `npm pack` drop the wasm from the published tarball.
  rm -f "$target/.gitignore"
  printf '%s\n' "$release" > "$target/.pin"
  rm -rf "$work"
  echo "vendor/${target##*/vendor/} fetched at $release"
}

fetch_bundle leptris/leptris-rs "$LEPTRIS_RS_RELEASE" \
  "leptris-wasm-${LEPTRIS_RS_RELEASE#leptris-v}.tgz" \
  "$here/vendor/leptris-wasm"
fetch_bundle lutaml/moxml-rs "$MOXML_RS_RELEASE" \
  "moxml-wasm-${MOXML_RS_RELEASE#v}.tgz" \
  "$here/vendor/moxml-wasm"

dataset="$here/test/data/moxml-conformance.json"
dataset_pin="$here/test/data/.pin"
if [ ! -f "$dataset_pin" ] || [ "$(cat "$dataset_pin")" != "$MOXML_RS_RELEASE" ]; then
  mkdir -p "$(dirname "$dataset")"
  curl -fsSL -o "$dataset" \
    "https://raw.githubusercontent.com/lutaml/moxml-rs/$MOXML_RS_RELEASE/tests/data/moxml-conformance.json"
  printf '%s\n' "$MOXML_RS_RELEASE" > "$dataset_pin"
  echo "test/data/moxml-conformance.json fetched at $MOXML_RS_RELEASE"
fi
