module.exports = import('./add.rs').then(function ({add}) {
  return add(2, 3);
});
