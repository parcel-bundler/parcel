module.exports = import('./test.rs').then(function ({test}) {
  return test(2, 3);
});
