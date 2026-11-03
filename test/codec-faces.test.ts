// Faces the lutaml-model TypeScript XML codecs need (lutaml/lutaml-model#1033):
// namespace and attribute reads, a namespace-aware and validated builder.
// What the shipped wasm cannot do is pinned at the bottom as UPSTREAM
// gaps: each names the export that would be needed.
import { beforeAll, describe, expect, it } from "vitest";
import { createDocument, initEngine, initModel, parse } from "../src/index.js";

beforeAll(async () => {
  await initEngine();
  await initModel();
});

const NS =
  '<a xmlns="urn:d" xmlns:p="urn:p" xmlns:q="urn:q" p:x="1" y="2" q:z="3" xml:lang="en">' +
  '<p:b p:x="b1"><c/></p:b><p:b/></a>';

describe("namespace reads", () => {
  it("answers namespaceUri, prefix and localName for elements", async () => {
    const root = (await parse(NS)).root()!;
    expect([root.namespaceUri(), root.prefix(), root.localName()]).toEqual(["urn:d", "", "a"]);
    const [b, b2] = root.children();
    expect([b.namespaceUri(), b.prefix(), b.localName(), b.qualifiedName(), b.name()]).toEqual([
      "urn:p", "p", "b", "p:b", "b",
    ]);
    expect(b2.namespaceUri()).toBe("urn:p");
    expect(b.children()[0].namespaceUri()).toBe("urn:d");
  });

  it("resolves nodes reached through XPath, not only through children()", async () => {
    const doc = await parse(NS);
    const [, second] = doc.xpathTyped("/*/*").nodes();
    expect(second.namespaceUri()).toBe("urn:p");
    expect(doc.xpathTyped("/*/*/*").nodes()[0].namespaceUri()).toBe("urn:d");
  });

  it("lists in-scope and declared bindings", async () => {
    const root = (await parse(NS)).root()!;
    const prefixes = (root.inScopeNamespaces() ?? []).map((b) => b.prefix).sort();
    expect(prefixes).toEqual(["", "p", "q", "xml"]);
    expect(root.declaredNamespaces()).toEqual(
      expect.arrayContaining([
        { prefix: "", uri: "urn:d" },
        { prefix: "p", uri: "urn:p" },
        { prefix: "q", uri: "urn:q" },
      ]),
    );
    expect(root.children()[0].declaredNamespaces()).toEqual([]);
  });

  it("answers undefined for a node that is not an attached element", async () => {
    const doc = await createDocument();
    expect(doc.createElement("loose").namespaceUri()).toBeUndefined();
    expect(doc.createText("t").namespaceUri()).toBeUndefined();
  });
});

describe("attributes", () => {
  it("lists name, prefix, local name, namespace URI and value", async () => {
    const root = (await parse(NS)).root()!;
    expect(root.attributes()).toEqual([
      { name: "p:x", prefix: "p", localName: "x", namespaceUri: "urn:p", value: "1" },
      { name: "y", prefix: "", localName: "y", namespaceUri: "", value: "2" },
      { name: "q:z", prefix: "q", localName: "z", namespaceUri: "urn:q", value: "3" },
      {
        name: "xml:lang", prefix: "xml", localName: "lang",
        namespaceUri: "http://www.w3.org/XML/1998/namespace", value: "en",
      },
    ]);
  });

  it("does not list xmlns declarations as attributes", async () => {
    const attrs = (await parse('<r xmlns:p="urn:p" a="1"/>')).root()!.attributes()!;
    expect(attrs.map((a) => a.name)).toEqual(["a"]);
  });

  it("reads values with entities decoded and by name", async () => {
    const root = (await parse('<r a="x &amp; y"/>')).root()!;
    expect(root.getAttribute("a")).toBe("x & y");
    expect(root.getAttribute("missing")).toBeUndefined();
  });

  it("resolves a prefix declared on an ancestor", async () => {
    const root = (await parse('<r xmlns:p="urn:p"><c p:k="v"/></r>')).root()!;
    expect(root.children()[0].attributes()![0].namespaceUri).toBe("urn:p");
  });
});

describe("namespace-aware builder", () => {
  it("builds prefixed and default-namespace elements that round-trip", async () => {
    const doc = await createDocument();
    const root = doc.setRoot(doc.createElementNS("urn:d", "root"));
    const child = doc.createElementNS("urn:p", "p:child");
    child.setAttributeNS("urn:p", "p:k", "v");
    child.setAttributeNS("urn:q", "q:z", "w");
    root.addChild(child).addChild(doc.createText("hi"));
    const xml = doc.toXml();
    expect(xml).toContain('xmlns="urn:d"');
    const back = (await parse(xml)).root()!;
    expect(back.namespaceUri()).toBe("urn:d");
    const c = back.children()[0];
    expect(c.namespaceUri()).toBe("urn:p");
    expect(c.attributes()!.map((a) => [a.name, a.namespaceUri, a.value])).toEqual([
      ["p:k", "urn:p", "v"],
      ["q:z", "urn:q", "w"],
    ]);
    expect(c.text()).toBe("hi");
  });

  it("does not redeclare a prefix already bound to the same URI in scope", async () => {
    const doc = await createDocument();
    const root = doc.setRoot(doc.createElementNS("urn:p", "p:root"));
    root.setAttributeNS("urn:p", "p:k", "v");
    expect(doc.toXml().match(/xmlns:p=/g)).toHaveLength(1);
  });

  it("rejects an inconsistent prefix/namespace pair", async () => {
    const doc = await createDocument();
    expect(() => doc.createElementNS("", "p:e")).toThrow(/needs a namespace/);
    const e = doc.createElement("e");
    expect(() => e.setAttributeNS("urn:x", "k", "v")).toThrow(/needs a prefix/);
    expect(() => e.setAttributeNS("", "p:k", "v")).toThrow(/needs a namespace/);
  });

  it("rejects invalid element and attribute names", async () => {
    const doc = await createDocument();
    for (const bad of ["", "1a", "a b", "a:b:c", "<x>", "a\"b"]) {
      expect(() => doc.createElement(bad), bad).toThrow(/invalid element name/);
    }
    expect(() => doc.createElement("ok").setAttribute("a b", "v")).toThrow(/invalid attribute name/);
    expect(() => doc.createElement("ok").setAttribute("xmlns:p", "urn:p")).not.toThrow();
  });
});

// UPSTREAM: not fixable over the shipped wasm. Each test pins today's
// behaviour so the day the export lands it goes red and gets replaced.
describe("UPSTREAM gaps (leptris-wasm / moxml-wasm exports missing)", () => {
  it("has no comment, CDATA or PI constructors (needs WasmDocument.create_comment / create_cdata / create_pi)", async () => {
    const doc = await createDocument();
    for (const name of ["create_comment", "create_cdata", "create_pi"]) {
      expect((doc.internal() as unknown as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  it("has no attribute removal (needs WasmNode.remove_attribute)", async () => {
    const root = (await parse('<r a="1"/>')).root()!;
    expect((root.internal() as unknown as Record<string, unknown>)["remove_attribute"]).toBeUndefined();
  });

  it("has no parse options: an entity bomb expands fully (needs a max-entity-expansion option on WasmDocument parse)", async () => {
    const decls = ['<!ENTITY e1 "aaaaaaaaaa">'];
    for (let i = 2; i <= 6; i++) decls.push(`<!ENTITY e${i} "${`&e${i - 1};`.repeat(10)}">`);
    const doc = await parse(`<!DOCTYPE r [${decls.join("")}]><r>&e6;</r>`);
    expect(doc.xpath("string-length(/r)")).toBe("1000000");
  });

  it("reports no position for malformed input (needs line/column on the parse error)", async () => {
    const error = await parse("<r>\n<c>\n</r>").catch((e: Error) => e);
    expect(String(error)).not.toMatch(/line|column|\b3\b/i);
  });
});
