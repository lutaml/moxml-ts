// The Document face: parse, root name, XPath 1.0 evaluation, and
// serialization, carried by the engine tier (leptris-wasm). The
// moxml contract these answers honor is the processing model.
import { WasmDocument } from "../vendor/leptris-wasm/leptris.js";
import { engine } from "./engine.js";

export class Document {
  constructor(private readonly native: WasmDocument) {}

  /** Root element name, or undefined for an empty document. */
  rootName(): string | undefined {
    return this.native.root_name();
  }

  /** Evaluate an XPath 1.0 expression; the string-value of the result. */
  xpath(expression: string): string {
    return this.native.xpath(expression);
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
