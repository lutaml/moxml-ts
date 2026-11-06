// The Document face: parse, node handles, XPath 1.0 evaluation
// (string-value and typed results), a small builder surface, and
// serialization — carried by the engine tier (leptris-wasm). The
// moxml contract these answers honor is the processing model.
import {
  WasmDocument,
  type WasmAttribute,
  type WasmXPathResult as NativeXPathResult,
} from "../vendor/leptris-wasm/leptris.js";
import { engine } from "./engine.js";
import { initModel, valid_lexical } from "./model.js";

/** The most attributes one element may carry, namespace declarations
 * included (the XPath `@*` route counts them; the snapshot does not, but
 * one limit for both keeps the rule simple). leptris-wasm 1.6.x keeps
 * the per-element attribute count in a byte: from 256 attributes on,
 * attribute_pairs / XPath `@*` report the count modulo 256 (256 reads
 * back as none, 301 as 45) or trap,
 * and a trap corrupts the wasm heap for the rest of the process. Input
 * and builder calls past the limit are refused before the native call. */
export const MAX_ATTRIBUTES = 255;

/** A document or builder call asked for more attributes on one element
 * than the engine can read back faithfully. `reason` is stable. */
export class AttributeLimitError extends Error {
  readonly reason = "attribute_limit";
  constructor(
    readonly count: number,
    readonly limit: number = MAX_ATTRIBUTES,
  ) {
    super(
      `element has ${count >= 0 ? `${count} attributes` : "too many attributes"}; the limit is ${limit} (namespace declarations included)`,
    );
    this.name = "AttributeLimitError";
  }
}

/** A namespace binding in scope on an element. `prefix` is "" for the
 * default namespace. */
export interface NamespaceBinding {
  prefix: string;
  uri: string;
}

/** An attribute with the pieces a codec needs. `namespaceUri` is ""
 * for an unprefixed attribute (no namespace, per Namespaces in XML). */
export interface Attribute {
  /** The qualified name as written, e.g. "xsi:type". */
  name: string;
  prefix: string;
  localName: string;
  namespaceUri: string;
  value: string;
}

const ELEMENT_KIND = 1;
const XML_NS = "http://www.w3.org/XML/1998/namespace";

function checkQName(kind: string, name: string): void {
  // `xmlns` / `xmlns:p` are namespace declarations, spelled as attributes.
  const declared = name.startsWith("xmlns:") ? name.slice(6) : undefined;
  const ok =
    name === "xmlns" ||
    (declared !== undefined ? valid_lexical("xs:NCName", declared) : valid_lexical("xs:QName", name));
  if (!ok) {
    throw new Error(`invalid ${kind} name: ${JSON.stringify(name)}`);
  }
}

function splitQName(qname: string): { prefix: string; localName: string } {
  const at = qname.indexOf(":");
  return at < 0
    ? { prefix: "", localName: qname }
    : { prefix: qname.slice(0, at), localName: qname.slice(at + 1) };
}

/** The native document handle the engine tier owns. */
export type NativeDocument = WasmDocument;

export class Node {
  private cachedPath: string | undefined;
  private pathEpoch: number;

  constructor(
    private readonly native: NativeNode,
    private readonly owner: Document,
    pathHint?: string,
  ) {
    this.cachedPath = pathHint;
    this.pathEpoch = owner.epoch;
  }

  /** Absolute positional XPath of this element in its document, or
   * undefined for a non-element or a node not attached to the tree.
   * The engine's XPath only runs from the document root, so
   * node-relative questions (namespaces, attributes) are asked
   * through this path. Appending a fresh node never shifts earlier
   * siblings; any other tree change (moving an attached node, replacing
   * the root) bumps the document epoch and drops every cached path. */
  private path(): string | undefined {
    if (this.native.kind() !== ELEMENT_KIND) return undefined;
    if (this.pathEpoch !== this.owner.epoch) {
      this.cachedPath = undefined;
      this.pathEpoch = this.owner.epoch;
    }
    if (this.cachedPath !== undefined) return this.cachedPath;
    const root = this.owner.root();
    if (root === undefined) return undefined;
    const target = this.native.ptr();
    const walk = (node: NativeNode, path: string): string | undefined => {
      if (node.ptr() === target) return path;
      let position = 0;
      for (const child of node.children()) {
        if (child.kind() !== ELEMENT_KIND) continue;
        position += 1;
        const found = walk(child, `${path}/*[${position}]`);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    this.cachedPath = walk(root.native, "/*[1]");
    return this.cachedPath;
  }

  private xp(expression: string): string {
    return this.owner.xpath(expression);
  }

  /** The element's qualified name as written ("p:b"). Answered by the
   * per-node faces (O(1)); undefined for a non-element. */
  qualifiedName(): string | undefined {
    if (this.native.kind() !== ELEMENT_KIND) return undefined;
    const local = this.native.name();
    if (local === undefined) return undefined;
    const prefix = this.native.prefix();
    return prefix === undefined || prefix === "" ? local : `${prefix}:${local}`;
  }

  /** Prefix of the element's qualified name ("" when unprefixed). */
  prefix(): string | undefined {
    if (this.native.kind() !== ELEMENT_KIND) return undefined;
    return this.native.prefix() ?? "";
  }

  /** Local part of the element's qualified name. */
  localName(): string | undefined {
    return this.name();
  }

  /** The element's namespace URI ("" when in no namespace); undefined
   * for a non-element. */
  namespaceUri(): string | undefined {
    if (this.native.kind() !== ELEMENT_KIND) return undefined;
    return this.native.namespace_uri() ?? "";
  }

  /** Every namespace binding in scope on the element (including the
   * implicit xml prefix). Undefined when not attached. */
  inScopeNamespaces(): NamespaceBinding[] | undefined {
    const path = this.path();
    return path === undefined ? undefined : this.bindingsAt(path);
  }

  private bindingsAt(path: string): NamespaceBinding[] {
    const count = this.owner.xpathCount(`${path}/namespace::*`);
    const out: NamespaceBinding[] = [];
    for (let i = 1; i <= count; i++) {
      const step = `${path}/namespace::*[${i}]`;
      out.push({ prefix: this.xp(`name(${step})`), uri: this.xp(`string(${step})`) });
    }
    return out;
  }

  /** The bindings this element introduces: in scope here but not the
   * same binding on its parent. A re-declaration of an identical
   * binding is not distinguishable and is not reported. */
  declaredNamespaces(): NamespaceBinding[] | undefined {
    const path = this.path();
    if (path === undefined) return undefined;
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    const inherited = new Map<string, string>();
    if (parentPath !== "") {
      for (const binding of this.bindingsAt(parentPath)) {
        inherited.set(binding.prefix, binding.uri);
      }
    }
    return this.bindingsAt(path).filter(
      (binding) =>
        binding.prefix !== "xml" && inherited.get(binding.prefix) !== binding.uri,
    );
  }

  /** The element's attributes (namespace declarations excluded) with
   * name, prefix, namespace URI and value, from one batched crossing.
   * Undefined for a non-element. */
  attributes(): Attribute[] | undefined {
    if (this.native.kind() !== ELEMENT_KIND) return undefined;
    // leptris-wasm (1.6.2 through 1.6.5) traps in the attribute
    // snapshot (wasm `unreachable`) when a no-namespace attribute
    // follows a namespaced one, and every trap corrupts the wasm heap
    // (memory access out of bounds after ~3,600). A caught trap is not
    // a safe fallback, so the snapshot is never called for an element
    // that could trigger it. A never-mutated parse whose source has no
    // such tag is safe throughout. Otherwise the element must be
    // attached (only then can the shape be asked of the tree): an
    // element with a prefixed attribute followed by an unprefixed one
    // (found once per document by Document.trapProne) is read through
    // positional XPath instead; a detached element cannot be vetted and
    // is refused rather than risk the trap.
    if (this.owner.mutatedOrSuspect()) {
      const path = this.path();
      if (path === undefined) {
        throw new Error(
          "attributes() of a detached element is unavailable: attach the element to the document first",
        );
      }
      if (this.mayTrapSnapshot()) return this.attributesViaXPath(path);
    }
    let pairs: WasmAttribute[];
    try {
      pairs = this.native.attribute_pairs();
    } catch {
      // Backstop for any other trap shape: stay on XPath for the document.
      this.owner.snapshotTrapped = true;
      const path = this.path();
      if (path === undefined) throw new Error("attributes() of a detached element is unavailable");
      return this.attributesViaXPath(path);
    }
    const out: Attribute[] = [];
    for (const pair of pairs) {
      const name = pair.name;
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      const { prefix, localName } = splitQName(name);
      const namespaceUri = prefix === "xml" ? XML_NS : (pair.uri ?? "");
      out.push({ name, prefix, localName, namespaceUri, value: pair.value });
    }
    return out;
  }

  private mayTrapSnapshot(): boolean {
    return this.owner.snapshotTrapped || this.owner.trapProne().has(this.native.ptr());
  }

  private attributesViaXPath(path: string): Attribute[] {
    const count = this.owner.xpathCount(`${path}/@*`);
    const out: Attribute[] = [];
    for (let i = 1; i <= count; i++) {
      const step = `${path}/@*[${i}]`;
      const name = this.xp(`name(${step})`);
      // Same contract as the snapshot path: declarations are not attributes.
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      const { prefix, localName } = splitQName(name);
      const namespaceUri =
        prefix === "" ? "" : prefix === "xml" ? XML_NS : this.resolvePrefix(path, prefix);
      out.push({ name, prefix, localName, namespaceUri, value: this.xp(`string(${step})`) });
    }
    return out;
  }

  /** The URI a prefix is bound to at `path`: the namespace axis, else
   * the nearest `xmlns:prefix` declaration on the element or an ancestor
   * (the axis does not report declarations set through the builder). */
  private resolvePrefix(path: string, prefix: string): string {
    const viaAxis = this.xp(`string(${path}/namespace::${prefix})`);
    if (viaAxis !== "") return viaAxis;
    const declaration = `xmlns:${prefix}`;
    for (let at: string = path; at !== ""; at = at.slice(0, at.lastIndexOf("/"))) {
      const count = this.owner.xpathCount(`${at}/@*`);
      for (let i = 1; i <= count; i++) {
        const step = `${at}/@*[${i}]`;
        if (this.xp(`name(${step})`) === declaration) return this.xp(`string(${step})`);
      }
    }
    return "";
  }

  /** The value of an attribute by qualified name, or undefined. */
  getAttribute(name: string): string | undefined {
    return this.attributes()?.find((attribute) => attribute.name === name)?.value;
  }

  /** Declare a namespace on this element: `xmlns:prefix="uri"`, or the
   * default namespace when `prefix` is "". */
  declareNamespace(prefix: string, uri: string): void {
    if (prefix !== "") checkQName("namespace prefix", prefix);
    this.guardWidth(prefix === "" ? "xmlns" : `xmlns:${prefix}`);
    this.owner.invalidateTraps();
    this.native.set_attribute(prefix === "" ? "xmlns" : `xmlns:${prefix}`, uri);
  }

  /** Set a namespaced attribute. The prefix of `qname` is declared on
   * this element unless it already resolves to `uri` in scope. */
  setAttributeNS(uri: string, qname: string, value: string): void {
    checkQName("attribute", qname);
    const { prefix } = splitQName(qname);
    if (prefix === "") {
      if (uri !== "") {
        throw new Error(`namespaced attribute ${JSON.stringify(qname)} needs a prefix`);
      }
    } else if (uri === "") {
      throw new Error(`prefixed attribute ${JSON.stringify(qname)} needs a namespace`);
    } else if (prefix !== "xml") {
      const bound = this.inScopeNamespaces()?.find((b) => b.prefix === prefix);
      if (bound?.uri !== uri) this.declareNamespace(prefix, uri);
    }
    this.guardWidth(qname);
    this.owner.invalidateTraps();
    this.native.set_attribute(qname, value);
  }

  /** Refuse an attribute name that would take this element past
   * MAX_ATTRIBUTES. The names are tracked on the document, seeded from
   * the element's own attributes the first time it is written to. */
  private guardWidth(name: string): void {
    const names = this.owner.attributeNames(this.native.ptr(), () => {
      try {
        return [
          ...(this.attributes() ?? []).map((attribute) => attribute.name),
          ...(this.declaredNamespaces() ?? []).map((b) => (b.prefix === "" ? "xmlns" : `xmlns:${b.prefix}`)),
        ];
      } catch {
        return [];
      }
    });
    if (names.has(name)) return;
    if (names.size >= MAX_ATTRIBUTES) throw new AttributeLimitError(names.size + 1);
    names.add(name);
  }

  /** Element name (element-kind nodes only), or undefined. */
  name(): string | undefined {
    return this.native.name();
  }

  /** Text content: text-kind nodes read their data, elements their
   * concatenated text. */
  text(): string | undefined {
    return this.native.text();
  }

  /** Engine node kind. */
  kind(): number {
    return this.native.kind();
  }

  /** Children across every served kind, in document order. */
  children(): Node[] {
    let position = 0;
    return this.native.children().map((child) => {
      if (child.kind() !== ELEMENT_KIND) return new Node(child, this.owner);
      position += 1;
      const parentPath = this.path();
      const hint = parentPath === undefined ? undefined : `${parentPath}/*[${position}]`;
      return new Node(child, this.owner, hint);
    });
  }

  /** Set an attribute (element-kind nodes). The name must be a valid
   * QName (so `xmlns`, `xmlns:p` and `p:a` are accepted). */
  setAttribute(name: string, value: string): void {
    checkQName("attribute", name);
    this.guardWidth(name);
    this.owner.invalidateTraps();
    this.native.set_attribute(name, value);
  }

  /** Append an owned node (same-document); returns the installed
   * handle. */
  addChild(child: Node): Node {
    this.owner.invalidateTraps();
    // A node the document did not just create is already placed in the
    // tree (or under a holder): adding it moves it, which shifts the
    // positional paths of its old and new siblings.
    this.owner.noteAdopted(child.native.ptr());
    return new Node(this.native.add_child(child.native), this.owner);
  }

  internal(): NativeNode {
    return this.native;
  }
}

type NativeNode = import("../vendor/leptris-wasm/leptris.js").WasmNode;

/** The typed XPath 1.0 result: exactly one of the four types is
 * meaningful, per the result's kind — 0 nodeset, 1 boolean, 2 number,
 * 3 string (the engine enum; the generated d.ts comment claims
 * 1-based, the runtime and leptris-rs's own tests are 0-based). */
export class XPathResult {
  constructor(
    private readonly native: NativeXPathResult,
    private readonly owner: Document,
  ) {}

  /** 0 nodeset, 1 boolean, 2 number, 3 string (engine enum,
   * 0-based — see the type doc). */
  kind(): number {
    return this.native.kind();
  }

  isNodeset(): boolean {
    return this.kind() === 0;
  }

  boolean(): boolean {
    return this.native.boolean();
  }

  number(): number {
    return this.native.number();
  }

  stringValue(): string {
    return this.native.stringValue();
  }

  /** The nodeset rows as node handles, document order. */
  nodes(): Node[] {
    return this.native.nodes().map((node) => new Node(node, this.owner));
  }
}

export class Document {
  /** Set once the engine's attribute snapshot has trapped on this
   * document; see Node.attributes(). */
  snapshotTrapped = false;

  private trapPtrs: Set<number> | undefined;

  private readonly written = new Map<number, Set<string>>();

  /** The attribute names known on the element at `ptr`; `seed` supplies
   * them the first time the element is written to. */
  attributeNames(ptr: number, seed: () => string[]): Set<string> {
    let names = this.written.get(ptr);
    if (names === undefined) {
      names = this.fresh.has(ptr) ? new Set() : new Set(seed());
      this.written.set(ptr, names);
    }
    return names;
  }

  /** Bumped by every tree change that can move an existing node; Node
   * path caches are valid only for the epoch they were taken in. */
  epoch = 0;

  /** Pointers of nodes created here and not yet added to a parent. */
  private readonly fresh = new Set<number>();

  /** Whether any native attribute read could trap: the document was
   * mutated, or its source has a trap-shaped tag. */
  mutatedOrSuspect(): boolean {
    return this.mayTrap;
  }

  /** Record that `ptr` is being added under a parent: a fresh node is a
   * plain append; any other is a move and drops cached paths. */
  noteAdopted(ptr: number): void {
    if (!this.fresh.delete(ptr)) this.epoch += 1;
  }

  /** Pointers of the attached elements whose attributes put a prefixed
   * one before an unprefixed one (the shape that traps the engine's
   * snapshot). One document-wide query, cached until the tree or an
   * attribute changes. A node absent from the set is either safe or
   * detached; detached nodes keep the guarded snapshot call. */
  trapProne(): Set<number> {
    if (this.trapPtrs === undefined && !this.mayTrap) this.trapPtrs = new Set();
    if (this.trapPtrs === undefined) {
      const prefixed = "contains(name(),':')";
      const shapes: string[] = [];
      for (let i = 1; i <= 2; i++) {
        shapes.push(`(@*[${i}][${prefixed}] and @*[position()>${i}][not(${prefixed})])`);
      }
      // Wider elements are flagged conservatively (slow but exact read).
      shapes.push(`(@*[3] and @*[${prefixed}])`);
      const result = this.native.xpath_full(`//*[${shapes.join(" or ")}]`);
      this.trapPtrs = new Set(result.nodes().map((node) => node.ptr()));
    }
    return this.trapPtrs;
  }

  invalidateTraps(): void {
    this.mayTrap = true;
    this.trapPtrs = undefined;
  }

  constructor(
    private readonly native: WasmDocument,
    private mayTrap = true,
  ) {}

  /** Root element name, or undefined for an empty document. */
  rootName(): string | undefined {
    return this.native.root_name();
  }

  /** The root element as a node handle. */
  root(): Node | undefined {
    const root = this.native.root();
    return root === undefined ? undefined : new Node(root, this, "/*[1]");
  }

  /** Create a detached element owned by this document. The name must
   * be a valid QName; the engine itself accepts any string. */
  createElement(name: string): Node {
    checkQName("element", name);
    const node = this.native.create_element(name);
    this.fresh.add(node.ptr());
    return new Node(node, this);
  }

  /** Create a detached element in a namespace: the element carries
   * the matching `xmlns` / `xmlns:prefix` declaration. An unprefixed
   * name with an empty `uri` is simply a no-namespace element. */
  createElementNS(uri: string, qname: string): Node {
    const { prefix } = splitQName(qname);
    if (prefix !== "" && uri === "") {
      throw new Error(`prefixed element ${JSON.stringify(qname)} needs a namespace`);
    }
    const element = this.createElement(qname);
    if (prefix !== "" || uri !== "") element.declareNamespace(prefix, uri);
    return element;
  }

  /** Create a detached text node owned by this document. */
  createText(text: string): Node {
    const node = this.native.create_text(text);
    this.fresh.add(node.ptr());
    return new Node(node, this);
  }

  /** Attach a detached element as the document's root. The engine
   * consumes the handle passed in; the installed root is returned and
   * is the one to keep using. */
  setRoot(root: Node): Node {
    this.invalidateTraps();
    this.fresh.delete(root.internal().ptr());
    this.epoch += 1;
    this.native.set_root(root.internal());
    return this.root()!;
  }

  /** Evaluate an XPath 1.0 expression; the string-value of the result. */
  xpath(expression: string): string {
    return this.native.xpath(expression);
  }

  /** Evaluate an XPath 1.0 expression; the full typed result. */
  xpathTyped(expression: string): XPathResult {
    return new XPathResult(this.native.xpath_full(expression), this);
  }

  /** Count the nodes matching an XPath 1.0 expression. */
  xpathCount(expression: string): number {
    return this.native.xpath_count(expression);
  }

  /** Serialize the document back to XML. */
  toXml(): string {
    return this.native.to_xml();
  }

  /** The native handle (for the sibling faces that consume whole
   * documents, e.g. XSD validate). */
  internal(): NativeDocument {
    return this.native;
  }

  dispose(): void {
    this.native.free();
  }
}

export async function parse(xml: string): Promise<Document> {
  await engine();
  await initModel();
  const scan = scanSource(xml);
  if (scan.widest > MAX_ATTRIBUTES) throw new AttributeLimitError(scan.widest);
  return new Document(new WasmDocument(xml), scan.mayTrap);
}

const TAG = /<[^\s/>!?]+((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g;

/** One pass over the start tags: whether any has a prefixed attribute
 * followed by an unprefixed one (declarations aside), the only shape
 * that traps the engine's attribute snapshot, and the most attributes
 * (declarations included) on a single tag. A scan that over-reports the
 * shape is safe; it only costs the document-wide check in
 * Document.trapProne. */
function scanSource(xml: string): { mayTrap: boolean; widest: number } {
  let mayTrap = false;
  let widest = 0;
  for (const tag of xml.matchAll(TAG)) {
    let prefixedSeen = false;
    let count = 0;
    for (const attr of (tag[1] ?? "").matchAll(ATTR)) {
      const name = attr[1] ?? "";
      count += 1;
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      if (name.includes(":")) prefixedSeen = true;
      else if (prefixedSeen) mayTrap = true;
    }
    if (count > widest) widest = count;
  }
  return { mayTrap, widest };
}

/** An empty document to build into: the placeholder root is
 * REPLACED by set_root (verified against the engine). */
export async function createDocument(): Promise<Document> {
  await engine();
  await initModel();
  return new Document(new WasmDocument("<tmp/>"));
}
