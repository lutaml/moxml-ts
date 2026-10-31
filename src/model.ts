// The model-tier binding: the pure-logic model faces from the
// moxml-wasm bundle — one implementation of the model, bound per
// language (no TS re-port). Same environment-aware init as the
// engine tier.
import {
  default as modelInit,
  initSync as modelInitSync,
  lexical_names,
  translate_regex_js,
  valid_lexical,
  WildcardFace,
  RegistryFace,
  type InitInput as ModelInitInput,
  type InitOutput as ModelInitOutput,
} from "../vendor/moxml-wasm/moxml.js";

export {
  lexical_names,
  translate_regex_js,
  valid_lexical,
  WildcardFace,
  RegistryFace,
};

let initPromise: Promise<ModelInitOutput> | null = null;

function wasmUrl(): URL {
  return new URL("../vendor/moxml-wasm/moxml_bg.wasm", import.meta.url);
}

async function startModel(input?: ModelInitInput): Promise<ModelInitOutput> {
  if (input) return modelInit({ module: input });
  const runningInNode =
    typeof process !== "undefined" &&
    Object.prototype.hasOwnProperty.call(process.versions, "node");
  if (runningInNode) {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(wasmUrl());
    return modelInitSync({ module: bytes });
  }
  return modelInit(wasmUrl());
}

export async function initModel(input?: ModelInitInput): Promise<void> {
  initPromise ??= startModel(input);
  await initPromise;
}
