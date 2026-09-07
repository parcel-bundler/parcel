const value = require('./value');
exports.run = () => import('./first').then(m => m.value + value);
