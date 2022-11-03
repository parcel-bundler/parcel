const {add} = require('./add.wasm');

exports.startWorker = function() {
  const worker = new Worker(new URL('worker.js', import.meta.url));
  worker.postMessage(add(2, 3));
};
