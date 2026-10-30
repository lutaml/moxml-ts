# Acceptance gap (moxml-ts#1, slice 1)

The acceptance baseline is the faces the legacy Opal surface pinned:
parse, XPath, serialize, builder, entities. This package's engine tier
is leptris-wasm; the bundle pinned here (leptris-rs `leptris-v1.5.0`)
serves a **string-level** face:

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
| entity registry (`declared?`, codepoint faces) | port of the moxml-rs `entity_registry` face + engine entity-ref support |
| XSD `validate` | the bundle exports `compile_xsd` but no validate face yet |

Slice 1 transfers the Opal expectations verbatim **where the face
exists** (test/acceptance.test.ts). The remaining expectations transfer
when the engine asks above land — they ride leptris-rs asks, never
local shims, so the single-XML-processing-model invariant holds in
this language too.
