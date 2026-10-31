// The cross-language conformance runner (moxml-ts): every row of the
// vendored dataset (fetched at the moxml-rs pin by fetch-wasm.sh)
// must answer through the wasm model faces exactly as the Ruby pins
// expect. Missing rows are failures — coverage is part of
// conformance. The xsd_regex_translation family is NOT in this
// runner yet: the regex face translates to the host dialect and the
// JS emission is its own translation problem (moxml-rs follow-up).
import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import {
  initModel,
  RegistryFace,
  valid_lexical,
  WildcardFace,
} from "../src/model.js";

const dataset = JSON.parse(
  await readFile(new URL("./data/moxml-conformance.json", import.meta.url), "utf8"),
);

beforeAll(async () => {
  await initModel();
});

describe("conformance: builtin_lexical", () => {
  it("carries the family", () => {
    expect(dataset.cases.builtin_lexical.length).toBeGreaterThanOrEqual(80);
  });

  it("answers every row through the wasm face", () => {
    for (const row of dataset.cases.builtin_lexical) {
      expect(valid_lexical(row.type, row.lexical), `${row.type} ${row.lexical}`).toBe(
        row.valid,
      );
    }
  });
});

describe("conformance: schema_wildcards", () => {
  it("carries the family", () => {
    expect(dataset.cases.schema_wildcards.length).toBeGreaterThanOrEqual(20);
  });

  it("answers every row through the wasm face", () => {
    for (const row of dataset.cases.schema_wildcards) {
      const w = new WildcardFace(
        row.constraint,
        row.process,
        row.not_namespace,
        row.not_qname,
      );
      expect(w.covers(row.item_namespace), `covers ${row.constraint} ${row.item_namespace}`).toBe(
        row.covers,
      );
      const exclusion = w.negative_exclusion(
        row.item_qname,
        row.item_namespace,
        row.defined,
        row.sibling_names,
      );
      expect(exclusion ?? null, `exclusion ${row.constraint} ${row.item_qname}`).toBe(
        row.exclusion,
      );
      w.free();
    }
  });
});

describe("conformance: entity_registry", () => {
  it("carries the family", () => {
    expect(dataset.cases.entity_registry.length).toBeGreaterThanOrEqual(10);
  });

  it("answers every row through the wasm face", () => {
    for (const row of dataset.cases.entity_registry) {
      const names = Object.keys(row.seed);
      const lexicals = names.map((n) => row.seed[n] as string);
      const registry = new RegistryFace(names, lexicals);
      const label = `seed ${JSON.stringify(row.seed)} ${row.qname}/${row.qcp}`;
      expect(registry.declared(row.qname), `declared ${label}`).toBe(row.declared);
      expect(registry.codepoint_for_name(row.qname) ?? null, `codepoint ${label}`).toBe(
        row.codepoint,
      );
      expect(registry.names_for_codepoint(row.qcp), `names ${label}`).toEqual(row.names);
      expect(
        registry.primary_name_for_codepoint(row.qcp) ?? null,
        `primary ${label}`,
      ).toBe(row.primary);
      expect(RegistryFace.standard_entity(row.qcp), `standard ${label}`).toBe(row.standard);
      expect(
        registry.should_restore(row.qcp, row.restore_entities, row.mode),
        `restore ${label}`,
      ).toBe(row.restore);
      registry.free();
    }
  });
});
