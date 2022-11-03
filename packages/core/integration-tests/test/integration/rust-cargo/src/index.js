module.exports = import('./lib.rs').then(function ({add}) {
  return add(2, 3);
});
