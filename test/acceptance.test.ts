// Acceptance baseline, slice 1 (moxml-ts#1): the expectations the
// legacy Opal surface pinned (lutaml/moxml spec/moxml/opal_smoke_spec,
// reference_opal_spec), transferred verbatim wherever the engine tier's
// current wasm face can answer them. Faces the wasm face cannot serve
// yet (node handles, builder, entities, XSD validate) are enumerated
// in docs/acceptance-gap.md and ride engine asks, not local shims.
import { describe, expect, it, beforeAll } from "vitest";
import { initEngine, parse, Document } from "../src/index.js";

beforeAll(async () => {
  await initEngine();
});

describe("parse (opal_smoke: parses XML string to document)", () => {
  it("parses XML string to document", async () => {
    const doc = await parse("<root><child>text</child></root>");
    expect(doc).toBeInstanceOf(Document);
    expect(doc.rootName()).toBe("root");
  });
});

describe("serialize (opal_smoke: round-trips parse and serialize)", () => {
  it("round-trips parse and serialize", async () => {
    const xml = '<person name="Alice"><age>30</age></person>';
    const doc = await parse(xml);
    const serialized = doc.toXml();
    expect(serialized).toContain("person");
    expect(serialized).toContain("Alice");
    expect(serialized).toContain("30");
  });

  it("handles namespaces", async () => {
    const xml = '<root xmlns:ns="http://example.com"><ns:child>data</ns:child></root>';
    const doc = await parse(xml);
    expect(doc.toXml()).toContain("ns:child");
  });

  it("handles CDATA sections", async () => {
    const xml = "<root><![CDATA[<script>alert('xss')</script>]]></root>";
    const doc = await parse(xml);
    expect(doc.toXml()).toContain("<script>");
  });

  it("handles comments", async () => {
    const xml = "<root><!-- a comment --><child/></root>";
    const doc = await parse(xml);
    expect(doc.toXml()).toContain("a comment");
  });

  it("handles processing instructions", async () => {
    const xml = '<?xml version="1.0"?><?pi-target pi-data?><root/>';
    const doc = await parse(xml);
    expect(doc.toXml()).toContain("pi-target");
  });
});

describe("xpath (full XPath 1.0 is the contract; the wasm face serves string-value and count)", () => {
  it("answers the string-value of a step", async () => {
    const doc = await parse("<root><child>text</child></root>");
    expect(doc.xpath("/root/child")).toBe("text");
  });

  it("counts matching nodes", async () => {
    const doc = await parse("<root><i/><i/><i/></root>");
    expect(doc.xpathCount("/root/i")).toBe(3);
    expect(doc.xpathCount("/root/nope")).toBe(0);
  });
});

describe("errors (reference_opal: raises a named ParseError for malformed input)", () => {
  it("rejects malformed input with the engine's error, not a silent answer", async () => {
    await expect(parse("<r><c></r>")).rejects.toThrow();
  });
});
