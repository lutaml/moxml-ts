// The Document face: parse, node handles, XPath 1.0 evaluation
// (string-value and typed results), a small builder surface, and
// serialization — carried by the engine tier (leptris-wasm). The
// moxml contract these answers honor is the processing model.
import {
  WasmDocument,
  type WasmXPathResult as NativeXPathResult,
} from "../vendor/leptris-wasm/leptris.js";
import { engine } from "./engine.js";

export class Node {
  constructor(private readonly native: NativeNode) {}

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
    return this.native.children().map((child) => new Node(child));
  }

  /** Set an attribute (element-kind nodes). */
  setAttribute(name: string, value: string): void {
    this.native.set_attribute(name, value);
  }

  /** Append an owned node (same-document); returns the installed
   * handle. */
  addChild(child: Node): Node {
    return new Node(this.native.add_child(child.native));
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
  constructor(private readonly native: NativeXPathResult) {}

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
    return this.native.nodes().map((node) => new Node(node));
  }
}

export class Document {
  constructor(private readonly native: WasmDocument) {}

  /** Root element name, or undefined for an empty document. */
  rootName(): string | undefined {
    return this.native.root_name();
  }

  /** The root element as a node handle. */
  root(): Node | undefined {
    const root = this.native.root();
    return root === undefined ? undefined : new Node(root);
  }

  /** Create a detached element owned by this document. */
  createElement(name: string): Node {
    return new Node(this.native.create_element(name));
  }

  /** Create a detached text node owned by this document. */
  createText(text: string): Node {
    return new Node(this.native.create_text(text));
  }

  /** Attach a detached element as the document's root. */
  setRoot(root: Node): void {
    this.native.set_root(root.internal());
  }

  /** Evaluate an XPath 1.0 expression; the string-value of the result. */
  xpath(expression: string): string {
    return this.native.xpath(expression);
  }

  /** Evaluate an XPath 1.0 expression; the full typed result. */
  xpathTyped(expression: string): XPathResult {
    return new XPathResult(this.native.xpath_full(expression));
  }

  /** Count the nodes matching an XPath 1.0 expression. */
  xpathCount(expression: string): number {
    return this.native.xpath_count(expression);
  }

  /** Serialize the document back to XML. */
  toXml(): string {
    return this.native.to_xml();
  }

  dispose(): void {
    this.native.free();
  }
}

export async function parse(xml: string): Promise<Document> {
  await engine();
  return new Document(new WasmDocument(xml));
}

/** An empty document to build into: the placeholder root is
 * REPLACED by set_root (verified against the engine). */
export async function createDocument(): Promise<Document> {
  await engine();
  return new Document(new WasmDocument("<tmp/>"));
}
