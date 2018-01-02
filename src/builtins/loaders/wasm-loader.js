module.exports = function loadWASMBundle(bundle) {
  return fetch(bundle)
    .then(function (res) {
      if (WebAssembly.compileStreaming) {
        return WebAssembly.compileStreaming(res);
      } else {
        return res.arrayBuffer()
          .then(function (data) {
            return WebAssembly.compile(data);
          });
      }
    })
    .then(function (wasmModule) {
      return new WebAssembly.Instance(wasmModule).exports;
    });
};
