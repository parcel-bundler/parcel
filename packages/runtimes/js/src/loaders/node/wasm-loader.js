const fs = require('fs');
const cache = require('../../cache');

module.exports = cache(function loadWASMBundle(bundle) {
  return new Promise(function(resolve, reject) {
    fs.readFile(__dirname + bundle, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data.buffer);
      }
    });
  })
    .then(function(data) {
      return WebAssembly.instantiate(data);
    })
    .then(function(wasmModule) {
      return wasmModule.instance.exports;
    });
});
