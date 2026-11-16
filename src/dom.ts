// The DOM bridge (moxml-ts#7, stage 1): parseToDOM / parseHTMLToDOM /
// Document#toDOM — one conversion walk from the engine-tier tree into
// the platform DOM. The engine still parses (leptris, one engine
// everywhere); the DOM shape is a facade at the binding tier — the
// architecture's rule is "backend ≠ API". Honest boundary: moxml's
// guarantees cover the parse and validation; post-conversion DOM
// mutation happens outside the model (a sink, never a parser).
import type { Document as MoxmlDocument, Node as MoxmlNode } from "./document.js";
import { parse } from "./document.js";

// Engine WasmNodeKind (leptris-rs wasmface enum).
export const NodeKind = {
  Other: 0,
  Element: 1,
  Text: 2,
  Comment: 3,
  Cdata: 4,
  Pi: 5,
  DocType: 6,
} as const;

/** The implementation face the bridge needs, structurally: satisfied
 * by the platform DOMImplementation (browsers) and by xmldom's (Node,
 * cast at the boundary — xmldom's own types are non-structural). */
interface BridgeImplementation {
  createDocument(namespace: string | null, qualifiedName: string | null): Document;
}

/** The platform DOM implementation: native in browsers,
 * @xmldom/xmldom in Node — a sink for converted trees, never a
 * parsing backend (the architecture's rule). */
async function platformImplementation(): Promise<BridgeImplementation> {
  if (typeof document !== "undefined" && document.implementation) {
    return document.implementation;
  }
  const xmldom = await import("@xmldom/xmldom");
  return new xmldom.DOMImplementation() as unknown as BridgeImplementation;
}

function elementFrom(node: MoxmlNode, dom: BridgeImplementation, doc: Document): Element {
  const el = doc.createElement(node.name() ?? "");
  // Namespace declarations are not attributes in the engine's model
  // (attribute_pairs never carries them) - the converted tree's
  // namespace bindings ride the element names, not xmlns attributes.
  for (const attr of node.attributePairs()) {
    el.setAttribute(attr.name, attr.value);
  }
  return el;
}

function convertChild(node: MoxmlNode, dom: BridgeImplementation, doc: Document): Node | undefined {
  switch (node.kind()) {
    case NodeKind.Element:
      return elementFrom(node, dom, doc);
    case NodeKind.Text:
      return doc.createTextNode(node.text() ?? "");
    case NodeKind.Comment:
      return doc.createComment(node.text() ?? "");
    case NodeKind.Cdata:
      return doc.createCDATASection(node.text() ?? "");
    case NodeKind.Pi: {
      const target = node.piTarget() ?? "";
      const data = node.text() ?? "";
      return doc.createProcessingInstruction(target, data);
    }
    default:
      // Doctype and the other kinds ride the boundary: the converted
      // tree is a sink, and DOM doctype attachment post-hoc is not a
      // faithful conversion. Documented, never silent for elements.
      return undefined;
  }
}

function convertChildren(node: MoxmlNode, dom: BridgeImplementation, domParent: Node, doc: Document): void {
  for (const child of node.children()) {
    const converted = convertChild(child, dom, doc);
    if (converted === undefined) continue;
    domParent.appendChild(converted);
    if (child.kind() === NodeKind.Element) {
      convertChildren(child, dom, converted, doc);
    }
  }
}

/** Convert a moxml document into the platform DOM: one recursive walk
 * of the engine-tier tree (children/kind/name/text + the batched
 * attribute snapshot), element children carrying their subtrees. */
export async function toDOM(doc: MoxmlDocument): Promise<Document> {
  const impl = await platformImplementation();
  const dom = impl.createDocument(null, null);
  const root = doc.root();
  if (root === undefined) {
    return dom;
  }
  const domRoot = elementFrom(root, impl, dom);
  dom.appendChild(domRoot);
  convertChildren(root, impl, domRoot, dom);
  return dom;
}

/** Parse XML with leptris-grade parsing and hand back the platform
 * DOM — the entire platform toolbox (querySelector, document.evaluate,
 * XSLTProcessor, XMLSerializer) over one engine's parse. */
export async function parseToDOM(xml: string): Promise<Document> {
  return toDOM(await parse(xml));
}

/** Parse HTML with leptris's WHATWG parser and hand back the
 * platform DOM. One engine everywhere: HTML parses through leptris's
 * own WHATWG parser (the wasm face, leptris-rs#22's tier-2 ask) —
 * never a second parser (DOMParser stays rejected by the
 * architecture). */
export async function parseHTMLToDOM(html: string): Promise<Document> {
  const { parseHtml } = await import("./engine.js");
  const native = await parseHtml(html);
  const doc = new (await import("./document.js")).Document(native);
  return toDOM(doc);
}
