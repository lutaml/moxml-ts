// The DOM-shaped live face (moxml-ts#7, stage 2): DOM Core
// interfaces over the wasm handles with LIVE identity. One wrapper
// per node for the document's lifetime — keyed on the engine's
// identity token (stable across every mutation) — so a mutation
// through any wrapper is visible through every wrapper, and the
// children lists re-read through the handle on each access (live,
// with no cache to go stale).
//
// Honest boundaries, per the issue: this face exists for
// environments without a platform DOM, or for consumers who want
// moxml semantics end to end. The parser is still leptris, always.
// CSS selectors ride the classic css→XPath translation (a focused
// subset, loud on everything else); `evaluate` on the engine tier
// is the general escape hatch.
import { parse, Document as MoxmlDocument } from "./document.js";
import { engine } from "./engine.js";
import type { WasmNode } from "../vendor/leptris-wasm/leptris.js";

// DOM nodeType constants.
const TYPE = {
  ELEMENT: 1,
  TEXT: 3,
  COMMENT: 8,
  CDATA: 4,
  PI: 7,
  DOCUMENT: 9,
} as const;

// Engine kind constants (WasmNodeKind).
const KIND = { Element: 1, Text: 2, Comment: 3, Cdata: 4, Pi: 5 } as const;

/** The css→XPath translation (the binding-tier classic). Subset:
 * type selectors, `*`, `#id`, `.class`, `[attr]`, `[attr=value]`,
 * descendant and child combinators. Everything else is a loud
 * error. */
export function cssToXPath(css: string): string {
  const parts = css.trim().split(/\s+/);
  const steps: string[] = [];
  let childCombinator = false;
  for (const part of parts) {
    if (part === ">") {
      if (childCombinator) throw new Error(`css: a combinator cannot follow ">"`);
      childCombinator = true;
      continue;
    }
    const step = selectorToStep(part);
    steps.push(childCombinator ? `/${step}` : `//${step}`);
    childCombinator = false;
  }
  if (steps.length === 0) throw new Error(`css: empty selector`);
  return steps.join("");
}

function selectorToStep(part: string): string {
  const tagMatch = part.match(/^[a-zA-Z][\w-]*/);
  let tag = "*";
  let i = 0;
  if (tagMatch) {
    tag = tagMatch[0];
    i = tagMatch[0].length;
  } else if (part.startsWith("*")) {
    i = 1;
  }
  const predicates: string[] = [];
  const classBits: string[] = [];
  while (i < part.length) {
    const ch = part[i]!;
    if (ch === "#") {
      const end = atomEnd(part, i + 1);
      predicates.push(`@id='${part.slice(i + 1, end)}'`);
      i = end;
    } else if (ch === ".") {
      const end = atomEnd(part, i + 1);
      classBits.push(part.slice(i + 1, end));
      i = end;
    } else if (ch === "[") {
      const end = part.indexOf("]", i);
      if (end === -1) throw new Error(`css: unterminated [attr]`);
      const attr = part.slice(i + 1, end);
      const eq = attr.indexOf("=");
      if (eq === -1) {
        predicates.push(`@${attr}`);
      } else {
        const name = attr.slice(0, eq).replace(/^@/, "");
        const value = attr.slice(eq + 1).replace(/^['"]|['"]$/g, "");
        predicates.push(`@${name}='${value}'`);
      }
      i = end + 1;
    } else {
      throw new Error(`css: unsupported character "${ch}"`);
    }
  }
  if (classBits.length > 0) {
    predicates.push(
      classBits
        .map((c) => `contains(concat(' ', normalize-space(@class), ' '), ' ${c} ')`)
        .join(" and "),
    );
  }
  return predicates.length > 0 ? `${tag}[${predicates.join(" and ")}]` : tag;
}

function atomEnd(source: string, start: number): number {
  const m = source.slice(start).match(/^[\w-]+/);
  if (!m) throw new Error(`css: empty atom`);
  return start + m[0].length;
}

/** One live node: element or misc (text/comment/CDATA/PI), kind-
 * driven. The DOM Core surface this face commits: nodeType,
 * nodeName/tagName, identity, live childNodes, firstChild/lastChild,
 * previousSibling/nextSibling, textContent (get/set),
 * appendChild/removeChild/insertBefore/replaceChild, and — on
 * elements — attributes, querySelector(All), getElementsByTagName.
 * The registry guarantees one wrapper per node, so identity holds
 * across every access path. */
export class LiveNode {
  private readonly native: WasmNode;
  private readonly registry: LiveRegistry;
  readonly kind: number;

  constructor(native: WasmNode, registry: LiveRegistry) {
    this.native = native;
    this.registry = registry;
    this.kind = native.kind();
  }

  internal(): WasmNode {
    return this.native;
  }

  /** Re-point to the tree's own handle: add_child receives the node
   * BY VALUE — wasm-bindgen zeroes the moved JS object — so the
   * wrapper adopts the installed handle the engine hands back.
   * The identity token survives (the tree re-links, never
   * re-allocates). */
  adopt(native: WasmNode): void {
    (this as unknown as { native: WasmNode }).native = native;
  }

  get nodeType(): number {
    switch (this.kind) {
      case KIND.Element:
        return TYPE.ELEMENT;
      case KIND.Text:
        return TYPE.TEXT;
      case KIND.Comment:
        return TYPE.COMMENT;
      case KIND.Cdata:
        return TYPE.CDATA;
      case KIND.Pi:
        return TYPE.PI;
      default:
        return 0;
    }
  }

  get nodeName(): string {
    switch (this.kind) {
      case KIND.Element:
        return this.native.name() ?? "";
      case KIND.Text:
        return "#text";
      case KIND.Comment:
        return "#comment";
      case KIND.Cdata:
        return "#cdata-section";
      case KIND.Pi:
        return this.native.pi_target() ?? "";
      default:
        return "";
    }
  }

  get tagName(): string {
    if (this.kind !== KIND.Element) throw new Error("tagName: element nodes only");
    return this.nodeName;
  }

  /** The identity token: stable for the document's lifetime, equal
   * across every wrapper of the same node (which is exactly one). */
  get identity(): number {
    return this.native.identity();
  }

  isElement(): boolean {
    return this.kind === KIND.Element;
  }

  /** Live children: every served kind, document order, re-read on
   * each access. */
  get childNodes(): LiveNodeList {
    return new LiveNodeList(() => this.native.children().map((c) => this.registry.wrap(c)));
  }

  /** Live element children. */
  get children(): LiveNodeList {
    return new LiveNodeList(() =>
      this.native
        .children()
        .filter((c) => c.kind() === KIND.Element)
        .map((c) => this.registry.wrap(c)),
    );
  }

  get firstChild(): LiveNode | null {
    return this.childNodes.item(0);
  }

  get lastChild(): LiveNode | null {
    const kids = this.childNodes;
    return kids.item(kids.length - 1);
  }

  get previousSibling(): LiveNode | null {
    const parent = this.native.parent();
    if (parent === undefined) return null;
    const siblings = parent.children().map((c) => c.identity());
    const mine = this.native.identity();
    const index = siblings.indexOf(mine);
    if (index <= 0) return null;
    return this.registry.wrap(parent.children()[index - 1]!);
  }

  get nextSibling(): LiveNode | null {
    const parent = this.native.parent();
    if (parent === undefined) return null;
    const siblings = parent.children().map((c) => c.identity());
    const index = siblings.indexOf(this.native.identity());
    if (index === -1 || index === siblings.length - 1) return null;
    return this.registry.wrap(parent.children()[index + 1]!);
  }

  /** The deep concatenated character data (DOM textContent). */
  get textContent(): string {
    return this.native.text() ?? "";
  }

  set textContent(value: string) {
    if (this.kind !== KIND.Element) throw new Error("textContent: element nodes only");
    this.native.clear_children();
    if (value !== "") {
      const text = this.registry.document().createText(value);
      this.native.add_child(text.internal());
    }
  }

  // -- the element attribute surface (setAttribute et al are
  // element-faces in the DOM; they live here so the registry's
  // unified wrapper carries them) --

  getAttribute(name: string): string | null {
    return this.native.attribute(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.native.set_attribute(name, value);
  }

  removeAttribute(name: string): boolean {
    return this.native.remove_attribute(name);
  }

  hasAttribute(name: string): boolean {
    return this.native.attribute(name) !== undefined;
  }

  appendChild(child: LiveNode): LiveNode {
    const installed = this.native.add_child(child.internal());
    child.adopt(installed);
    return child;
  }

  insertBefore(newChild: LiveNode, before: LiveNode): LiveNode {
    before.internal().insert_before(newChild.internal());
    return newChild;
  }

  removeChild(child: LiveNode): LiveNode {
    child.internal().remove();
    return child;
  }

  replaceChild(newChild: LiveNode, oldChild: LiveNode): LiveNode {
    oldChild.internal().insert_before(newChild.internal());
    oldChild.internal().remove();
    return newChild;
  }

  querySelector(css: string): LiveNode | null {
    return this.querySelectorAll(css)[0] ?? null;
  }

  querySelectorAll(css: string): LiveNode[] {
    const xpath = cssToXPath(css);
    const results = this.registry
      .document()
      .internal()
      .xpath_full(xpath)
      .nodes();
    // Subtree scoping: keep only the results inside THIS element
    // (the document-wide face answers; the containment walk keeps
    // the DOM semantics of context-scoped selectors).
    return results
      .filter((n: WasmNode) => this.containsNative(this.native, n))
      .map((n: WasmNode) => this.registry.wrap(n));
  }

  private containsNative(ancestor: WasmNode, node: WasmNode): boolean {
    let current: WasmNode | undefined = node;
    while (true) {
      current = current.parent();
      if (current === undefined) return false;
      if (current.identity() === ancestor.identity()) return true;
    }
  }

  getElementsByTagName(tag: string): LiveNode[] {
    return this.querySelectorAll(tag);
  }
}

/** A live children list: re-reads through the handle on every
 * access, so mutations through any wrapper are visible here. */
export class LiveNodeList {
  private readonly read: () => LiveNode[];

  constructor(read: () => LiveNode[]) {
    this.read = read;
  }

  get length(): number {
    return this.read().length;
  }

  toArray(): LiveNode[] {
    return this.read();
  }

  map<T>(fn: (node: LiveNode) => T): T[] {
    return this.read().map(fn);
  }

  item(index: number): LiveNode | null {
    return this.read()[index] ?? null;
  }

  *[Symbol.iterator](): Iterator<LiveNode> {
    yield* this.read();
  }
}

/** One wrapper per node, scoped to its document. */
class LiveRegistry {
  private readonly nodes = new Map<number, LiveNode>();
  private readonly doc: MoxmlDocument;
  // Created nodes (create_*) are wasm-OWNED allocations: their
  // backing frees when the last JS reference dies. The registry
  // retains every created wrapper so the live face's nodes live for
  // the document's lifetime.
  private readonly kept: unknown[] = [];

  constructor(doc: MoxmlDocument) {
    this.doc = doc;
  }

  keep(wrapper: unknown): void {
    this.kept.push(wrapper);
  }

  document(): MoxmlDocument {
    return this.doc;
  }

  wrap(native: WasmNode): LiveNode {
    const id = native.identity();
    const existing = this.nodes.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = new LiveNode(native, this);
    this.nodes.set(id, created);
    return created;
  }
}

/** The live document: the registry owner plus the DOM Document
 * surface. */
export class LiveDocument {
  private readonly registry: LiveRegistry;

  constructor(doc: MoxmlDocument) {
    this.registry = new LiveRegistry(doc);
  }

  get nodeType(): number {
    return TYPE.DOCUMENT;
  }

  get nodeName(): string {
    return "#document";
  }

  get documentElement(): LiveNode | null {
    const root = this.registry.document().root();
    return root === undefined ? null : this.registry.wrap(root.internal());
  }

  createElement(tag: string): LiveNode {
    const wrapper = this.registry.document().createElement(tag);
    this.registry.keep(wrapper);
    return this.registry.wrap(wrapper.internal());
  }

  createTextNode(text: string): LiveNode {
    const wrapper = this.registry.document().createText(text);
    this.registry.keep(wrapper);
    return this.registry.wrap(wrapper.internal());
  }

  createComment(text: string): LiveNode {
    return this.registry.wrap(this.registry.document().internal().create_comment(text));
  }

  createCDATASection(text: string): LiveNode {
    return this.registry.wrap(this.registry.document().internal().create_cdata(text));
  }

  createProcessingInstruction(target: string, data: string): LiveNode {
    return this.registry.wrap(
      this.registry.document().internal().create_pi(target, data),
    );
  }

  querySelector(css: string): LiveNode | null {
    return this.documentElement?.querySelector(css) ?? null;
  }

  querySelectorAll(css: string): LiveNode[] {
    return this.documentElement?.querySelectorAll(css) ?? [];
  }

  getElementsByTagName(tag: string): LiveNode[] {
    return this.getElementsByTagNameFrom(this.documentElement, tag);
  }

  /** The contract's serialization shape (long-form empties): the
   * engine's DEFAULT to_xml answers self-closing, so the committed
   * face (serialize-with-options) answers here. */
  async toXml(): Promise<string> {
    const { serializeWithOptions } = await import("./engine.js");
    return serializeWithOptions(this.registry.document().toXml(), 0, true);
  }

  dispose(): void {
    this.registry.document().dispose();
  }

  private getElementsByTagNameFrom(
    root: LiveNode | null,
    tag: string,
  ): LiveNode[] {
    return root?.getElementsByTagName(tag) ?? [];
  }
}

/** Parse XML with leptris and hand back the live document. */
export async function parseLive(xml: string): Promise<LiveDocument> {
  await engine();
  return new LiveDocument(await parse(xml));
}
