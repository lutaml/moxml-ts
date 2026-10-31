// The XSD validation face: compile a schema and validate documents
// through the engine tier. Compile and validate expose together —
// compile-without-validate is a half-face and never ships.
import {
  compile_xsd,
  type WasmDocument,
  WasmSchema,
} from "../vendor/leptris-wasm/leptris.js";
import type { Document } from "./document.js";
import { engine } from "./engine.js";

export class Schema {
  constructor(private readonly native: WasmSchema) {}

  /** Validate a document: the validity answer plus the engine's
   * structured error rows of this run (empty when valid). */
  validate(doc: Document): { valid: boolean; errors: string[] } {
    const valid = this.native.validate_doc(doc.internal());
    return { valid, errors: valid ? [] : this.native.last_errors() };
  }

  dispose(): void {
    this.native.free();
  }
}

/** Compile an XSD schema (tier-1 subset; pass the head document —
 * schema-set compilation is not served by the wasm face yet). */
export async function compileXsd(xsd: string): Promise<Schema> {
  await engine();
  return new Schema(compile_xsd(xsd));
}
