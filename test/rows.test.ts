// The data-plane rows conformance (moxml-ts): every case of the
// vendored rows dataset (fetched at the moxml-rs pin) must answer
// byte-identical tuples through the model bundle's DocumentFace —
// the same rows the Rust reference emits (testsuite:
// tests/data-plane-rows.json; the contract: processing-model § The
// data plane).
import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { initModel } from "../src/model.js";
import { DocumentFace } from "../vendor/moxml-wasm/moxml.js";

const rowsData = JSON.parse(
  await readFile(new URL("./data/data-plane-rows.json", import.meta.url), "utf8"),
);

const encoder = new TextEncoder();

beforeAll(async () => {
  await initModel();
});

describe("data-plane rows conformance", () => {
  const cases = Object.entries(rowsData.cases);

  it("carries the dataset", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  it("answers byte-identical tuples on every case", async () => {
    let fail = 0;
    for (const [id, caseData] of cases) {
      const doc = new DocumentFace(encoder.encode(caseData.xml as string));
      const got = doc.element_rows();
      const want = caseData.rows as unknown[];
      expect(got.length, `case ${id} row count`).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        if (JSON.stringify(got[i]) !== JSON.stringify(want[i])) {
          fail++;
          console.log(`case ${id} row ${i}: got ${JSON.stringify(got[i])}, want ${JSON.stringify(want[i])}`);
        }
      }
    }
    expect(fail, "divergent rows").toBe(0);
  });
});
