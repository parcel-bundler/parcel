export default Promise.all([import('./a.js'), import('./b.js')])
  .then(modules => Promise.all(modules.map(mod => mod.default)));
