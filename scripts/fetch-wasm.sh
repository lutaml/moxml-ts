#!/usr/bin/env bash
# Fetches the pinned wasm bundles and the conformance dataset:
#   engine tier  — leptris-wasm from the leptris-rs release
#   model tier   — moxml-wasm  from the moxml-rs release (the pure-logic
#                  model faces; one implementation, bound per language)
# plus test/data/moxml-conformance.json at the moxml-rs pin.
# The pins live here (one line each) so a train bump is a one-line diff.
set -euo pipefail

LEPTRIS_RS_RELEASE="${LEPTRIS_RS_RELEASE:-leptris-v1.6.5}"
MOXML_RS_RELEASE="${MOXML_RS_RELEASE:-v0.1.1}"

# sha256 of each pinned download. A release bump changes these too; an
# override of a *_RELEASE variable needs the matching *_SHA256 override.
LEPTRIS_WASM_SHA256="${LEPTRIS_WASM_SHA256:-a132860d601f4d0da940f563b1dd51bd5c6eea4e2cc45ec7de5a701ca4aec22a}"
MOXML_WASM_SHA256="${MOXML_WASM_SHA256:-97c4307e08ccc4e4afbf90f7fc0270b28551651ac7998776b062fae6ffd186e4}"
CONFORMANCE_SHA256="${CONFORMANCE_SHA256:-6530bb0dd7a314a4c9bbb39d54e0e9ce203e92ceb4ca09551a6f951965c02545}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

verify_sha() { # file expected label
  local actual
  actual="$(sha256_of "$1")"
  if [ "$actual" != "$2" ]; then
    echo "checksum mismatch for $3: expected $2, got $actual" >&2
    exit 1
  fi
}

here="$(cd "$(dirname "$0")/.." && pwd)"

# Public release assets are fetched with curl, so a plain `npm install`
# (including a git dependency) needs no `gh` and no token.
fetch_bundle() { # repo release asset target sha256
  local repo="$1" release="$2" asset="$3" target="$4" sha="$5"
  if [ -f "$target/.pin" ] && [ "$(cat "$target/.pin")" = "$release" ]; then
    rm -f "$target/.gitignore"
    echo "vendor/${target##*/vendor/} already at $release"
    return 0
  fi
  local work
  work="$(mktemp -d)"
  curl -fsSL -o "$work/bundle.tgz" \
    "https://github.com/$repo/releases/download/$release/$asset"
  verify_sha "$work/bundle.tgz" "$sha" "$asset"
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
  "$here/vendor/leptris-wasm" "$LEPTRIS_WASM_SHA256"
fetch_bundle lutaml/moxml-rs "$MOXML_RS_RELEASE" \
  "moxml-wasm-${MOXML_RS_RELEASE#v}.tgz" \
  "$here/vendor/moxml-wasm" "$MOXML_WASM_SHA256"

dataset="$here/test/data/moxml-conformance.json"
dataset_pin="$here/test/data/.pin"
if [ ! -f "$dataset_pin" ] || [ "$(cat "$dataset_pin")" != "$MOXML_RS_RELEASE" ]; then
  mkdir -p "$(dirname "$dataset")"
  tmp_dataset="$(mktemp)"
  curl -fsSL -o "$tmp_dataset" \
    "https://raw.githubusercontent.com/lutaml/moxml-rs/$MOXML_RS_RELEASE/tests/data/moxml-conformance.json"
  verify_sha "$tmp_dataset" "$CONFORMANCE_SHA256" "moxml-conformance.json"
  mv "$tmp_dataset" "$dataset"
  printf '%s\n' "$MOXML_RS_RELEASE" > "$dataset_pin"
  echo "test/data/moxml-conformance.json fetched at $MOXML_RS_RELEASE"
fi
