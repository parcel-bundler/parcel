module.exports = Promise.all([import('./async1'), import('./async2')]).then(
  ([a, b]) => a.default.length + b.default.length,
);
