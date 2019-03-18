module.exports = function loadWASMBundle(bundle) {
  return fetch(bundle)
    .then(res => {
      if (WebAssembly.instantiateStreaming) {
        return WebAssembly.instantiateStreaming(res);
      } else {
        return res.arrayBuffer()
          .then(data => WebAssembly.instantiate(data));
      }
    })
    .then(wasmModule => wasmModule.instance.exports);
};
