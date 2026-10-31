# Acceptance gap (moxml-ts#1, slice 2)

The acceptance baseline is the faces the legacy Opal surface pinned:
parse, XPath, serialize, builder, entities. The package binds two
wasm tiers: the **engine** (leptris-wasm, pinned `leptris-v1.6.0`)
for parse/nodes/XPath/builder/serialize, and the **model faces**
(moxml-wasm, pinned `v0.1.1`) for the pure-logic model — one
implementation of the model, bound per language, never re-ported.

## Engine-tier faces (leptris-wasm, pinned `leptris-v1.6.0`)

| served | face |
|---|---|
| yes | parse to document, root name, node handles (`Node`: name/text/kind/children in document order) |
| yes | serialize round-trip (namespaces, CDATA, comments, PIs) |
| yes | builder (`createElement`/`createText`/`addChild`/`setAttribute`/`setRoot` — the placeholder root is replaced) |
| yes | XPath 1.0 — string-value (`xpath`), count (`xpathCount`), and the FULL typed result (`xpathTyped`: nodeset/boolean/number/string) |

| not served yet | what it needs |
|---|---|
| XSD `validate` | wired in leptris/leptris-rs#18 — rides the next train; `compile_xsd` stays unexposed until validate is served beside it (no half-faces) |

## Model-tier faces (moxml-wasm, pinned `v0.1.1`)

| served | face |
|---|---|
| yes | builtin lexical table (`validLexical`, `lexicalNames`) |
| yes | XSD-regex translation to the JS dialect (`translateRegexJs` — compile with `u`, test through the JS engine) |
| yes | wildcard admission + exclusion (`WildcardFace`) |
| yes | entity registry (`RegistryFace`) |

The conformance runner (`test/conformance.test.ts`) drives **every
row of all four families** of the vendored dataset (fetched at the
moxml-rs pin) through these faces — 0 divergences; missing rows are
failures.
