/* eslint-env browser */

const isFetchable = value =>
  value instanceof URL || typeof value === 'string' || value instanceof Request;

const isWasmInstance = value => value instanceof WebAssembly.Instance;

const canInstantiateStreaming =
  typeof WebAssembly.instantiateStreaming === 'function';

const streamErrorMessage = [
  '`WebAssembly.instantiateStreaming` failed. Assuming this is because your',
  'server does not serve wasm with `application/wasm` MIME type. Falling back',
  'to `WebAssembly.instantiate` which is slower. Original error:\n',
].join(' ');

const instantiate = (request, imports) =>
  request
    .then(response => response.arrayBuffer())
    .then(bytes => WebAssembly.instantiate(bytes, imports));

const instantiateRequest = (request, imports) =>
  canInstantiateStreaming
    ? WebAssembly.instantiateStreaming(request, imports).catch(
        error => (
          // eslint-disable-next-line no-console
          console.error(streamErrorMessage, error),
          instantiate(request, imports)
        ),
      )
    : instantiate(request, imports);

const instantiateModule = async (module, imports) => {
  const result = await WebAssembly.instantiate(module, imports);
  return isWasmInstance(result) ? {instance: result, module} : result;
};

export const load = async (wasm, imports) => {
  const {instance, module} = await (isFetchable(wasm)
    ? instantiateRequest(fetch(wasm), imports)
    : instantiateModule(wasm, imports));

  load.__wbindgen_wasm_module = module;
  return instance.exports;
};
