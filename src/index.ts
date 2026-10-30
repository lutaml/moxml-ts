//! The moxml XML processing model — TypeScript binding.
//!
//! Engines parse and evaluate (leptris-wasm here); moxml owns the
//! single committed answer to every semantic question, so which engine
//! is running is a deployment decision, never an API decision. The
//! normative contract is the moxml processing model
//! (docs/_references/processing-model.adoc in lutaml/moxml).

export * from "./engine.js";
export * from "./document.js";
