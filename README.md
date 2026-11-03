# moxml-ts

The moxml XML processing model — TypeScript implementation.

moxml is a *correct/harmonized* XML model engine: it does not parse XML itself. Engines parse and evaluate; moxml owns the single committed answer to every semantic question — node identity and document order, namespaces, XPath 1.0 result semantics, serialization, XSD validation semantics, error shapes — so that *which engine is running* is a deployment decision, never an API decision.

## The contract

The normative contract is the moxml processing model: [`docs/_references/processing-model.adoc`](https://github.com/lutaml/moxml/blob/main/docs/_references/processing-model.adoc) in lutaml/moxml, pinned executable expectations in `spec/consistency/`. It is living and versioned — not a frozen interface snapshot. Every face implemented here carries mirrored conformance pins so cross-language agreement is tested, never assumed.

## Scope of this package

- **Engine backend (v1, only)**: leptris-wasm — the same engine everywhere, no browser-vs-Node divergence. Runs in browsers and Node.
- **Model faces mirrored from moxml-rs**: document order, error taxonomy, validation semantics, serialization contracts.
- **Acceptance baseline**: the faces the legacy Opal surface pinned (parse, XPath, serialize, builder, entities) — the Opal suite's expectations become this package's acceptance tests.

Non-goals (v1): DOM / xmldom alternate backends (later, only behind the same cross-backend conformance gates), HTML parsing.

## Roadmap

See [docs/architecture.md](docs/architecture.md) for the layered architecture and phased plan (shared across moxml, moxml-rs, moxml-ts).

## Team

Permissions mirror [lutaml/moxml](https://github.com/lutaml/moxml) (staff admin; developers/ci/editors push). All changes via PRs.

## Gaps that need a wasm export (not shimmed here)

These need a change in moxml-rs / leptris, so they are not faked in TypeScript;
`test/codec-faces.test.ts` pins each so it goes red when the export lands.

- Comment, CDATA and processing-instruction nodes: `WasmDocument.create_comment`,
  `create_cdata`, `create_pi`.
- Removing an attribute: `WasmNode.remove_attribute`.
- Parse policy: a parse-options argument with a maximum entity expansion
  (a 10^6x entity bomb currently expands in full).
- Malformed-input errors with line and column.
