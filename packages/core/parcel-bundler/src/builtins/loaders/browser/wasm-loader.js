module.exports = function loadWASMBundle(bundle) {
  return fetch(bundle)
    .then(function (res) {
      // if (WebAssembly.instantiateStreaming) {
      //   console.log('instantiateStreaming')
      //   return WebAssembly.instantiateStreaming(res);
      // } else {
        return res.arrayBuffer()
          .then(function (data) {
            console.log('instantiate');
            const deps = {
              'global': {},
              'env': {
                'memory': new WebAssembly.Memory({initial: 10, limit: 100}),
                'table': new WebAssembly.Table({initial: 0, element: 'anyfunc'})
              }
            }
            return WebAssembly.instantiate(data, deps);
          });
      // }
    })
    .then(function (wasmModule) {
      console.log(wasmModule);
      return wasmModule.instance.exports;
    });
};
