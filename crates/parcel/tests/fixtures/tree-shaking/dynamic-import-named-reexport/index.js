output = Promise.all([import('./barrel.js'), import('./preview.js')])
  .then(([module]) => module.renderToCanvas());
