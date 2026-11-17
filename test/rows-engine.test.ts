// The ENGINE tier joins the rows conformance: the canonical dataset's
// tuples answered through leptris's WasmDocument.element_rows() must
// be byte-identical to the reference tier's (DocumentFace) and to the
// vendored file — three implementations, one contract (processing-
// model § The data plane).
import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { initEngine } from "../src/engine.js";
import { parse } from "../src/document.js";
import { initModel } from "../src/model.js";
import { DocumentFace } from "../vendor/moxml-wasm/moxml.js";

const rowsData = JSON.parse(
  await readFile(new URL("./data/data-plane-rows.json", import.meta.url), "utf8"),
);
const encoder = new TextEncoder();

beforeAll(async () => {
  await initEngine();
  await initModel();
});

describe("engine-tier rows conformance", () => {
  it("answers the contract tuples identically to the reference tier", async () => {
    let fail = 0;
    for (const [id, caseData] of Object.entries(rowsData.cases)) {
      const xml = caseData.xml as string;
      const want = caseData.rows as unknown[];

      const engineRows = (await parse(xml)).elementRows();
      const refRows = new DocumentFace(encoder.encode(xml)).element_rows();

      if (JSON.stringify(engineRows) !== JSON.stringify(want)) {
        fail++;
        console.log(`engine ${id}: got ${JSON.stringify(engineRows).slice(0, 160)}`);
      }
      if (JSON.stringify(refRows) !== JSON.stringify(want)) {
        fail++;
        console.log(`reference ${id}: divergent`);
      }
    }
    expect(fail, "divergent rows across the tiers").toBe(0);
  });

  it("carries the node table for the DOM bridge", async () => {
    const doc = await parse("<r><a x=\"1\">t</a><b/></r>");
    const table = doc.nodeTable();
    // Every served node: r, a, the text run "t", b — document order.
    expect(table.length).toBe(4);
    const kinds = table.map((row) => (row as unknown[])[1]);
    expect(kinds).toEqual([1, 1, 2, 1]); // element, element, text, element
  });
});
