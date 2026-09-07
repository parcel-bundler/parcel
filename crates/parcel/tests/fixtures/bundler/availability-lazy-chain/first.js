const value = require('./value');
exports.run = () => import('./second').then(m => m.value + value);
