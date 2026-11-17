// The live-face conformance (moxml-ts#7, stage 2): LIVE identity —
// one wrapper per node; mutations through any wrapper visible
// through every wrapper; children lists re-read live; the mutation
// surface (append/remove/insert/replace, attributes, textContent);
// the css→XPath querySelector subset. The parser is still leptris.
import { describe, expect, it, beforeAll } from "vitest";
import { initEngine } from "../src/engine.js";
import { parse, parseLive, cssToXPath } from "../src/index.js";
import { serializeWithOptions } from "../src/engine.js";

beforeAll(async () => {
  await initEngine();
});

describe("live identity", () => {
  it("hands back ONE wrapper per node across every access path", async () => {
    const live = await parseLive("<r><a/><b/></r>");
    const docEl = live.documentElement!;
    const viaChildNodes = docEl.childNodes.item(0)!;
    const viaQuery = live.querySelector("a")!;
    expect(viaChildNodes.identity).toBe(viaQuery.identity);
    expect(viaChildNodes).toBe(viaQuery); // the same JS object
  });

  it("keeps identity stable across mutations", async () => {
    const live = await parseLive("<r><a/></r>");
    const a = live.querySelector("a")!;
    const before = a.identity;
    const fresh = live.createElement("fresh");
    live.documentElement!.appendChild(fresh);
    // The moved-by-value handle was adopted: the wrapper still
    // answers, and the identity token survives the tree's adoption.
    expect(a.identity).toBe(before);
    const q = live.querySelector("fresh")!;
    expect(q.identity).toBe(fresh.identity);
    expect(q).toBe(fresh); // the registry's one-wrapper guarantee
  });
});

describe("live mutations", () => {
  it("append through one wrapper is visible through another", async () => {
    const live = await parseLive("<r><a/></r>");
    const a = live.querySelector("a")!;
    const child = live.createElement("sub");
    child.setAttribute("k", "v");
    a.appendChild(child);
    // The document-level serializer sees it (the contract's
    // long-form empties).
    expect(await live.toXml()).toContain('<sub k="v"></sub>');
    // And the root's live children list reflects the new depth.
    expect(a.childNodes.length).toBe(1);
    expect(a.firstChild!.getAttribute?.("k") ?? (a.firstChild!.internal() as never as { attribute(n: string): string }).attribute("k")).toBe("v");
  });

  it("removeChild detaches through the handle", async () => {
    const live = await parseLive("<r><a/><b/></r>");
    const b = live.querySelector("b")!;
    live.documentElement!.removeChild(b);
    expect(live.querySelector("b")).toBeNull();
    expect(live.documentElement!.childNodes.length).toBe(1);
  });

  it("insertBefore and replaceChild place nodes correctly", async () => {
    const live = await parseLive("<r><a/><b/></r>");
    const docEl = live.documentElement!;
    const mid = live.createElement("mid");
    const b = live.querySelector("b")!;
    docEl.insertBefore(mid, b);
    expect(docEl.childNodes.map((n) => n.nodeName)).toEqual(["a", "mid", "b"]);
    const replacement = live.createElement("z");
    docEl.replaceChild(replacement, b);
    expect(docEl.childNodes.map((n) => n.nodeName)).toEqual(["a", "mid", "z"]);
  });

  it("textContent set clears and replaces", async () => {
    const live = await parseLive("<r><a>old</a></r>");
    const a = live.querySelector("a")!;
    a.textContent = "new";
    expect(a.textContent).toBe("new");
    expect(await live.toXml()).toContain("<a>new</a>");
  });
});

describe("live queries", () => {
  const doc = async () =>
    parseLive(
      '<catalog><book id="b1" class="Featured">One</book><book id="b2">Two</book><shelf><book id="b3">Three</book></shelf></catalog>',
    );

  it("querySelector matches by tag, #id, .class, and [attr]", async () => {
    const live = await doc();
    expect(live.querySelector("book")!.textContent).toBe("One");
    expect(live.querySelector("#b2")!.textContent).toBe("Two");
    expect(live.querySelector(".Featured")!.textContent).toBe("One");
    expect(live.querySelector("[id=b3]")!.textContent).toBe("Three");
  });

  it("scopes subtree queries to the context element", async () => {
    const live = await doc();
    const shelf = live.querySelector("shelf")!;
    const inside = shelf.querySelectorAll("book");
    expect(inside.length).toBe(1);
    expect(inside[0]!.textContent).toBe("Three");
  });

  it("translates css to xpath for the general path", () => {
    expect(cssToXPath("book")).toBe("//book");
    expect(cssToXPath("catalog > shelf")).toBe("//catalog/shelf");
    expect(cssToXPath("book.featured[id]")).toContain("contains");
  });

  it("rejects unsupported selectors loudly", async () => {
    const live = await doc();
    expect(() => live.querySelector(":pseudo")).toThrow(/css/);
  });
});

describe("the live face rides the same engine tier", () => {
  it("shares the parse path with the moxml face", async () => {
    const xml = "<r>shared</r>";
    const plain = await parse(xml);
    const live = await parseLive(xml);
    expect(await live.toXml()).toBe((await serializeWithOptions(xml, 0, true)));
  });
});
