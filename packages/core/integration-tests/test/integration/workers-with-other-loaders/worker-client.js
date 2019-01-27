const {add} = require('./add.wasm');

exports.startWorker = function() {
  const worker = new Worker('worker.js');
  worker.postMessage(add(2, 3));
};
