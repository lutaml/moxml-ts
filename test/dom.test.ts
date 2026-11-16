// The DOM-bridge contract (moxml-ts#7, stage 1): the converted tree
// is the platform DOM — structure, attributes, every served node
// kind — and the platform toolbox works on it. The xmldom path runs
// here (vitest = Node); the native-DOM path runs in the playwright
// browser harness. Post-conversion mutation is outside the model.
import { describe, expect, it } from "vitest";
import { XMLSerializer } from "@xmldom/xmldom";
import { parseToDOM, parseHTMLToDOM, NodeKind } from "../src/dom.js";
import { parse } from "../src/document.js";

const SRC = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<catalog xmlns="urn:cat" lang="en">',
  "  <book id=\"b1\" edition=\"2nd\">A Title</book>",
  "  <notes><![CDATA[raw <stuff>]]></notes>",
  "  <!-- shelf comment -->",
  "  <?render mode=\"fancy\"?>",
  "  <empty/>",
  "</catalog>",
].join("\n");

describe("parseToDOM", () => {
  it("converts the element tree with namespaces and attributes", async () => {
    const dom = await parseToDOM(SRC);
    const root = dom.documentElement!;
    expect(root.tagName).toBe("catalog");
    // Namespace declarations are not attributes in the engine's
    // model - the bridge carries element attributes only.
    expect(root.getAttribute("lang")).toBe("en");
    const books = root.getElementsByTagName("book");
    expect(books.length).toBe(1);
    expect(books[0]!.getAttribute("id")).toBe("b1");
    expect(books[0]!.getAttribute("edition")).toBe("2nd");
    expect(books[0]!.textContent).toBe("A Title");
  });

  it("preserves mixed content and whitespace runs", async () => {
    const dom = await parseToDOM("<r>a<b/>c</r>");
    const root = dom.documentElement!;
    const kids = Array.from(root.childNodes).map((n) => n.nodeType);
    expect(kids).toEqual([3, 1, 3]); // text, element, text
    expect(root.childNodes[0]!.textContent).toBe("a");
    expect(root.childNodes[2]!.textContent).toBe("c");
  });

  it("carries CDATA sections through as CDATA", async () => {
    const dom = await parseToDOM(SRC);
    const notes = dom.documentElement!.getElementsByTagName("notes")[0]!;
    const cdata = Array.from(notes.childNodes).find(
      (n) => n.nodeType === 4,
    );
    expect(cdata).toBeDefined();
    expect(cdata!.textContent).toBe("raw <stuff>");
  });

  it("carries comments and processing instructions", async () => {
    const dom = await parseToDOM(SRC);
    const root = dom.documentElement!;
    const comment = Array.from(root.childNodes).find(
      (n) => n.nodeType === 8,
    );
    expect(comment!.textContent).toContain("shelf comment");
    const pi = Array.from(root.childNodes).find((n) => n.nodeType === 7);
    expect(pi).toBeDefined();
  });

  it("hands back a DOM the platform toolbox works on", async () => {
    const dom = await parseToDOM(SRC);
    expect(dom.getElementsByTagName("book")[0]!.textContent).toBe("A Title");
    const serialized = new XMLSerializer().serializeToString(dom);
    expect(serialized).toContain("<book");
    expect(serialized).toContain("edition=\"2nd\"");
  });

});

describe("the bridge on the moxml Document", () => {
  it("toDOM() rides the parsed document handle", async () => {
    const doc = await parse("<r><a x=\"1\">t</a></r>");
    const dom = await doc.toDOM();
    expect(dom.documentElement!.tagName).toBe("r");
    expect(
      dom.documentElement!.getElementsByTagName("a")[0]!.getAttribute("x"),
    ).toBe("1");
  });
});

describe("parseHTMLToDOM", () => {
  it("parses HTML through leptris's WHATWG parser onto the DOM", async () => {
    const dom = await parseHTMLToDOM(
      "<html><head><title>t</title></head><body><p id=\"x\">hello</p><br><p>second</p></body></html>",
    );
    const ps = dom.getElementsByTagName("p");
    expect(ps.length).toBe(2);
    expect(ps[0]!.getAttribute("id")).toBe("x");
    expect(ps[0]!.textContent).toBe("hello");
    expect(dom.getElementsByTagName("title")[0]!.textContent).toBe("t");
  });

  it("carries void elements and structure", async () => {
    const dom = await parseHTMLToDOM("<body><img src=\"a.png\"><div>text</div></body>");
    const img = dom.getElementsByTagName("img");
    expect(img.length).toBe(1);
    expect(img[0]!.getAttribute("src")).toBe("a.png");
    expect(dom.getElementsByTagName("div")[0]!.textContent).toBe("text");
  });
});

describe("NodeKind", () => {
  it("mirrors the engine enum", () => {
    expect(NodeKind.Element).toBe(1);
    expect(NodeKind.Text).toBe(2);
    expect(NodeKind.Cdata).toBe(4);
  });
});
