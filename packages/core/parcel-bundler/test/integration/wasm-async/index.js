module.exports = import('./add.wasm').then(function ({add}) {
  return add(2, 3);
});
