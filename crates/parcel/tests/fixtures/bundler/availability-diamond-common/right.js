const value = require('./value');
exports.run = () => import('./leaf').then(m => m.value + value);
