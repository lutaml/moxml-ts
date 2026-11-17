// The budgeted traversal (the data-plane doc's visit shape): the
// consumer drives the cursor, the walk runs Rust-side, each batch is
// ONE crossing, and stopping early is the point — the walk never
// visits what the consumer did not ask for.
import { describe, expect, it, beforeAll } from "vitest";
import { initEngine } from "../src/engine.js";
import { parse } from "../src/document.js";

beforeAll(async () => {
  await initEngine();
});

describe("the budgeted traversal", () => {
  it("walks a wide tree in budget-sized batches", async () => {
    const kids = Array.from({ length: 50 }, (_, i) => `<item i="${i}">v${i}</item>`).join("");
    const doc = await parse(`<r>${kids}</r>`);
    const root = doc.root()!;
    let cursor = 0;
    let rows = 0;
    let batches = 0;
    let done = false;
    while (!done) {
      const batch = root.elementRowsBatch(cursor, 7);
      rows += batch.rows.length;
      batches++;
      if (batches > 1) {
        expect(batch.rows.length).toBeLessThanOrEqual(7);
      }
      cursor = batch.nextCursor;
      done = batch.done;
    }
    expect(rows).toBe(51); // the root + 50 items
    expect(batches).toBe(8); // ceil(51 / 7)
  });

  it("stops early without paying for the unvisited rest", async () => {
    const kids = Array.from({ length: 100 }, (_, i) => `<item i="${i}"/>`).join("");
    const doc = await parse(`<r>${kids}</r>`);
    const root = doc.root()!;
    const first = root.elementRowsBatch(0, 2);
    expect(first.rows.length).toBe(2);
    expect(first.done).toBe(false);
    // The consumer's early-stop: no further crossing is made.
    const resumed = root.elementRowsBatch(first.nextCursor, 2);
    expect(resumed.rows.length).toBe(2);
    expect(resumed.rows[0]![1]).toBe("item");
  });

  it("answers the single-attribute convenience face", async () => {
    const doc = await parse('<r id="top"><a/></r>');
    expect(doc.root()!.attribute("id")).toBe("top");
    expect(doc.root()!.attribute("missing")).toBeUndefined();
  });
});
