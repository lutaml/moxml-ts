// Engine-tier binding: lazy, environment-aware initialization of the
// vendored leptris-wasm bundle. The bundle is pinned by
// scripts/fetch-wasm.sh (.pin records the leptris-rs release); Node
// reads the file, browsers let the bundler resolve the URL.
import {
  c14n_canonicalize as wasmC14nCanonicalize,
  default as wasmInit,
  initSync,
  serialize_with_options as wasmSerializeWithOptions,
  type InitInput,
  type InitOutput,
} from "../vendor/leptris-wasm/leptris.js";

/** Canonicalize (C14N 1.0, comments stripped): the engine's
 * canonical form — sorted attributes, long-form empties, expanded
 * references — the shape the conformance dataset's c14n family
 * pins. */
export async function c14nCanonicalize(xml: string): Promise<string> {
  await engine();
  return wasmC14nCanonicalize(xml, false);
}

/** Serialize with emitter options (indent, expand_empty): the
 * long-form-empty posture the conformance dataset's serialization
 * family pins. */
export async function serializeWithOptions(
  xml: string,
  indent: number,
  expandEmpty: boolean,
): Promise<string> {
  await engine();
  return wasmSerializeWithOptions(xml, indent, expandEmpty);
}

let initPromise: Promise<InitOutput> | null = null;

function wasmUrl(): URL {
  return new URL("../vendor/leptris-wasm/leptris_bg.wasm", import.meta.url);
}

async function startEngine(input?: InitInput): Promise<InitOutput> {
  if (input) return wasmInit({ module: input });
  const runningInNode =
    typeof process !== "undefined" &&
    Object.prototype.hasOwnProperty.call(process.versions, "node");
  if (runningInNode) {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(wasmUrl());
    return initSync({ module: bytes });
  }
  return wasmInit(wasmUrl());
}

export async function initEngine(input?: InitInput): Promise<void> {
  initPromise ??= startEngine(input);
  await initPromise;
}

export async function engine(): Promise<InitOutput> {
  await initEngine();
  return initPromise!;
}
