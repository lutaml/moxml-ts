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

  constructor(
    private readonly native: NativeNode,
    private readonly owner: Document,
    pathHint?: string,
  ) {
    this.cachedPath = pathHint;
  }

  /** Absolute positional XPath of this element in its document, or
   * undefined for a non-element or a node not attached to the tree.
   * The engine's XPath only runs from the document root, so
   * node-relative questions (namespaces, attributes) are asked
   * through this path. Appending never shifts earlier siblings, so
   * the path stays valid. */
  private path(): string | undefined {
    if (this.native.kind() !== ELEMENT_KIND) return undefined;
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
    // that could trigger it: an element with a prefixed attribute
    // followed by an unprefixed one (found once per document by
    // Document.trapProne) is read through positional XPath instead.
    if (this.mayTrapSnapshot()) return this.attributesViaXPath();
    let pairs: WasmAttribute[];
    try {
      pairs = this.native.attribute_pairs();
    } catch {
      // Backstop for any other trap shape: stay on XPath for the document.
      this.owner.snapshotTrapped = true;
      return this.attributesViaXPath();
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

  private attributesViaXPath(): Attribute[] | undefined {
    const path = this.path();
    if (path === undefined) return undefined;
    const count = this.owner.xpathCount(`${path}/@*`);
    const out: Attribute[] = [];
    for (let i = 1; i <= count; i++) {
      const step = `${path}/@*[${i}]`;
      const name = this.xp(`name(${step})`);
      const { prefix, localName } = splitQName(name);
      const namespaceUri =
        prefix === ""
          ? ""
          : prefix === "xml"
            ? XML_NS
            : this.xp(`string(${path}/namespace::${prefix})`);
      out.push({ name, prefix, localName, namespaceUri, value: this.xp(`string(${step})`) });
    }
    return out;
  }

  /** The value of an attribute by qualified name, or undefined. */
  getAttribute(name: string): string | undefined {
    return this.attributes()?.find((attribute) => attribute.name === name)?.value;
  }

  /** Declare a namespace on this element: `xmlns:prefix="uri"`, or the
   * default namespace when `prefix` is "". */
  declareNamespace(prefix: string, uri: string): void {
    if (prefix !== "") checkQName("namespace prefix", prefix);
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
    this.owner.invalidateTraps();
    this.native.set_attribute(qname, value);
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
      const hint =
        this.cachedPath === undefined ? undefined : `${this.cachedPath}/*[${position}]`;
      return new Node(child, this.owner, hint);
    });
  }

  /** Set an attribute (element-kind nodes). The name must be a valid
   * QName (so `xmlns`, `xmlns:p` and `p:a` are accepted). */
  setAttribute(name: string, value: string): void {
    checkQName("attribute", name);
    this.owner.invalidateTraps();
    this.native.set_attribute(name, value);
  }

  /** Append an owned node (same-document); returns the installed
   * handle. */
  addChild(child: Node): Node {
    this.owner.invalidateTraps();
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
    return new Node(this.native.create_element(name), this);
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
    return new Node(this.native.create_text(text), this);
  }

  /** Attach a detached element as the document's root. The engine
   * consumes the handle passed in; the installed root is returned and
   * is the one to keep using. */
  setRoot(root: Node): Node {
    this.invalidateTraps();
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
  return new Document(new WasmDocument(xml), sourceMayTrapSnapshot(xml));
}

const TAG = /<[^\s/>!?]+((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g;

/** Whether the source has a tag with a prefixed attribute followed by
 * an unprefixed one (declarations aside): the only shape that traps the
 * engine's attribute snapshot. A scan that over-reports is safe; it
 * only costs the document-wide check in Document.trapProne. */
function sourceMayTrapSnapshot(xml: string): boolean {
  for (const tag of xml.matchAll(TAG)) {
    let prefixedSeen = false;
    for (const attr of (tag[1] ?? "").matchAll(ATTR)) {
      const name = attr[1] ?? "";
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      if (name.includes(":")) prefixedSeen = true;
      else if (prefixedSeen) return true;
    }
  }
  return false;
}

/** An empty document to build into: the placeholder root is
 * REPLACED by set_root (verified against the engine). */
export async function createDocument(): Promise<Document> {
  await engine();
  await initModel();
  return new Document(new WasmDocument("<tmp/>"));
}
