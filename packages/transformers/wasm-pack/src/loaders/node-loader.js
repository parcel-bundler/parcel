/* eslint-env node */
/* global WebAssembly */

import {readFile} from 'fs';
import {join} from 'path';
import {promisify} from 'util';

export const load = async (wasm, imports) => {
  const wasmPath = join(__dirname, wasm);
  const bytes = await promisify(readFile)(wasmPath);

  const wasmModule = new WebAssembly.Module(bytes);
  const wasmInstance = new WebAssembly.Instance(wasmModule, imports);

  load.__wbindgen_wasm_module = wasmModule;
  return wasmInstance.exports;
};
