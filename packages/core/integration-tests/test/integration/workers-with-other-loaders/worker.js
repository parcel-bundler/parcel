const {add} = require('./add.wasm');

self.addEventListener('message', () => {
  self.postMessage(add(2, 3));
});
