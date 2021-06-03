import initFn, {transform} from './wasm/dist-web/parcel_js_swc_wasm.js';

export const init = initFn();

function transformWrapper(config) {
  let result = transform(config);
  return {
    ...result,
    // Hydrate Uint8Array into Buffer
    code: Buffer.from(result.code.buffer),
    // https://github.com/cloudflare/serde-wasm-bindgen/issues/10
    dependencies: result.dependencies?.map(d => ({
      ...d,
      attributes:
        d.attributes != null
          ? Object.fromEntries([...d.attributes])
          : undefined,
    })),
    hoist_result:
      result.hoist_result != null
        ? {
            ...result.hoist_result,
            imported_symbols: Object.fromEntries([
              ...result.hoist_result.imported_symbols,
            ]),
            exported_symbols: Object.fromEntries([
              ...result.hoist_result.exported_symbols,
            ]),
            dynamic_imports: Object.fromEntries([
              ...result.hoist_result.dynamic_imports,
            ]),
          }
        : undefined,
  };
}

export {transformWrapper as transform};
