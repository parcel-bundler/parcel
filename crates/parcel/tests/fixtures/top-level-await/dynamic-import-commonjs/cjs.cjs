sideEffect('cjs');
module.exports = import('./async.js').then(m => m.value);
