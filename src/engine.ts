// Engine-tier binding: lazy, environment-aware initialization of the
// vendored leptris-wasm bundle. The bundle is pinned by
// scripts/fetch-wasm.sh (.pin records the leptris-rs release); Node
// reads the file, browsers let the bundler resolve the URL.
import {
  default as wasmInit,
  initSync,
  type InitInput,
  type InitOutput,
} from "../vendor/leptris-wasm/leptris.js";

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
