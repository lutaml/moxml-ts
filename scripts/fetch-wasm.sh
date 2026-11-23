#!/usr/bin/env bash
# Fetches the pinned wasm bundles and the conformance dataset:
#   engine tier  — leptris-wasm from the leptris-rs release
#   model tier   — moxml-wasm  from the moxml-rs release (the pure-logic
#                  model faces; one implementation, bound per language)
# plus test/data/moxml-conformance.json and test/data/data-plane-rows.json
# at the moxml-rs pin.
# The pins live here (one line each) so a train bump is a one-line diff.
set -euo pipefail

LEPTRIS_RS_RELEASE="${LEPTRIS_RS_RELEASE:-leptris-v1.9.0}"
MOXML_RS_RELEASE="${MOXML_RS_RELEASE:-v0.1.8}"

# sha256 of each pinned download. A release bump changes these too; an
# override of a *_RELEASE variable needs the matching *_SHA256 override.
LEPTRIS_WASM_SHA256="${LEPTRIS_WASM_SHA256:-9911f9d1f31ea92a507aedaa0b970ab80b21637ff7e0147fa45ffeceb1f29fe5}"
MOXML_WASM_SHA256="${MOXML_WASM_SHA256:-6a35025ac033faf34915d9df38fe81146d2cabe6759c395e2a7b2f3c4fd8b6de}"
CONFORMANCE_SHA256="${CONFORMANCE_SHA256:-6d4921c9bef9386bf942ce62d5e4227f439f424542284d8b607a7fdfa199567c}"
ROWS_SHA256="${ROWS_SHA256:-ee2f4415106be2fb0d16373537c7785a841d90f435accb95d7dde3fa7768823c}"

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
rows_pin="$here/test/data/.rows-pin"
rows="$here/test/data/data-plane-rows.json"
if [ ! -f "$rows_pin" ] || [ "$(cat "$rows_pin")" != "$MOXML_RS_RELEASE" ]; then
  mkdir -p "$(dirname "$rows")"
  tmp_rows="$(mktemp)"
  curl -fsSL -o "$tmp_rows" \
    "https://raw.githubusercontent.com/lutaml/moxml-rs/$MOXML_RS_RELEASE/tests/data/data-plane-rows.json"
  verify_sha "$tmp_rows" "$ROWS_SHA256" "data-plane-rows.json"
  mv "$tmp_rows" "$rows"
  printf '%s\n' "$MOXML_RS_RELEASE" > "$rows_pin"
  echo "test/data/data-plane-rows.json fetched at $MOXML_RS_RELEASE"
fi
