module.exports = () =>
  Promise.all([import('./left'), import('./right')]).then(modules =>
    Promise.all(modules.map(m => m.run())),
  );
