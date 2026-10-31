// Acceptance baseline, slice 1 (moxml-ts#1): the expectations the
// legacy Opal surface pinned (lutaml/moxml spec/moxml/opal_smoke_spec,
// reference_opal_spec), transferred verbatim wherever the engine tier's
// current wasm face can answer them. Faces the wasm face cannot serve
// yet (node handles, builder, entities, XSD validate) are enumerated
// in docs/acceptance-gap.md and ride engine asks, not local shims.
import { describe, expect, it, beforeAll } from "vitest";
import {
  createDocument,
  initEngine,
  parse,
  Document,
  Node,
} from "../src/index.js";

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

// Slice 4 (leptris-wasm 1.6.0): node handles, builder, typed XPath —
// the opal_smoke expectations transferred verbatim.

describe("navigation (opal_smoke: parses XML string to document)", () => {
  it("answers root and child names through node handles", async () => {
    const doc = await parse("<root><child>text</child></root>");
    const root = doc.root()!;
    expect(root.name()).toBe("root");
    expect(root.children()[0]!.name()).toBe("child");
  });

  it("reads child kinds and text content in document order", async () => {
    const doc = await parse("<root>lead<mid/>tail</root>");
    const children = doc.root()!.children();
    expect(children.map((c) => c.kind())).toEqual([2, 1, 2]); // Text=2, Element=1 (WasmNodeKind)
    expect(children[0]!.text()).toBe("lead");
    expect(doc.root()!.text()).toBe("leadtail");
  });
});

describe("builder (opal_smoke: builds XML document from scratch)", () => {
  it("builds XML document from scratch", async () => {
    const doc = await createDocument();
    const root = doc.createElement("root");
    root.setAttribute("attr", "value");
    const text = doc.createText("hello");
    root.addChild(text);
    doc.setRoot(root);

    expect(doc.toXml()).toContain('attr="value"');
    expect(doc.toXml()).toContain("hello");
  });
});

describe("typed xpath (full XPath 1.0 result shapes)", () => {
  it("returns node-set rows in document order", async () => {
    const doc = await parse("<root><i>1</i><i>2</i></root>");
    const result = doc.xpathTyped("/root/i");
    expect(result.isNodeset()).toBe(true);
    const nodes = result.nodes();
    expect(nodes.length).toBe(2);
    expect(nodes.map((n: Node) => n.text())).toEqual(["1", "2"]);
  });

  it("returns booleans and numbers with their kinds", async () => {
    const doc = await parse("<root><i/><i/></root>");
    const flag = doc.xpathTyped("count(/root/i) = 2");
    expect(flag.kind()).toBe(1); // boolean
    expect(flag.boolean()).toBe(true);

    const count = doc.xpathTyped("count(/root/i)");
    expect(count.kind()).toBe(2); // number
    expect(count.number()).toBe(2);

    const str = doc.xpathTyped("concat('a', 'b')");
    expect(str.kind()).toBe(3); // string
    expect(str.stringValue()).toBe("ab");
  });
});

// XSD validate (leptris-wasm 1.6.1): compile + validate expose
// together — no half-faces.

describe("xsd validation", () => {
  it("admits a valid instance and rejects an invalid one with rows", async () => {
    const { compileXsd, parse } = await import("../src/index.js");
    const schema = await compileXsd(
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="r"><xs:complexType><xs:sequence>
          <xs:element name="a" type="xs:string" maxOccurs="unbounded"/>
        </xs:sequence></xs:complexType></xs:element>
      </xs:schema>`,
    );
    const good = schema.validate(await parse("<r><a/><a/></r>"));
    expect(good.valid).toBe(true);
    expect(good.errors).toEqual([]);

    const bad = schema.validate(await parse("<r><b/></r>"));
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.errors[0]).toContain("content model");
    schema.dispose();
  });
});
