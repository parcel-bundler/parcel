require('./a.css');

export default import('./bazz').then(mod => mod.default);
