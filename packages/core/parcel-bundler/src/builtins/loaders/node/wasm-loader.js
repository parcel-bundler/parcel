var fs = require('fs');

module.exports = function loadWASMBundle(bundle) {
  return new Promise((resolve, reject) => {
    fs.readFile(__dirname + bundle, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.buffer);
      }
    });
  })
  .then(data => WebAssembly.instantiate(data))
  .then(wasmModule => wasmModule.instance.exports);
};
