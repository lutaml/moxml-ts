# Acceptance gap (moxml-ts#1, slice 2)

The acceptance baseline is the faces the legacy Opal surface pinned:
parse, XPath, serialize, builder, entities. The package binds two
wasm tiers: the **engine** (leptris-wasm, pinned
`leptris-v1.5.0`) for parse/XPath/serialize, and the **model faces**
(moxml-wasm, pinned by moxml-rs release — currently `v0.1.0`) for the
pure-logic model — one implementation of the model, bound per
language, never re-ported.

## Engine-tier faces (leptris-wasm)

| served today | face |
|---|---|
| yes | parse to document, root name |
| yes | serialize round-trip (namespaces, CDATA, comments, PIs) |
| yes | XPath 1.0 — string-value of the result (`xpath`) |
| yes | XPath 1.0 — result count (`xpathCount`) |

| not served by leptris-wasm 1.5.0 | what it needs from the engine |
|---|---|
| node handles (element/text/... navigation, `children`, `name`, `text`, `data`) | wasm-bindgen node handles with identity + document order |
| full XPath result shapes (node-sets to iterate, booleans, numbers) | typed result face, not string-value only |
| builder DSL (create element/text, attributes, `add_child`) | write face on the wasm side |
| XSD `validate` | the bundle exports `compile_xsd` but no validate face yet |

These ride leptris/leptris-rs#15 — never local shims.

## Model-tier faces (moxml-wasm)

| served | face |
|---|---|
| yes | builtin lexical table (`validLexical`, `lexicalNames`) |
| yes | wildcard admission + exclusion (`WildcardFace`) |
| yes | entity registry (`RegistryFace`) |
| not yet | XSD-regex translation — the face translates to the HOST dialect; the JS emission is its own translation problem (moxml-rs follow-up), so the `xsd_regex_translation` family stays out of the conformance runner until then |

The conformance runner (`test/conformance.test.ts`) drives every row
of the vendored dataset (fetched at the moxml-rs pin) through these
faces — 0 divergences; missing rows are failures.
