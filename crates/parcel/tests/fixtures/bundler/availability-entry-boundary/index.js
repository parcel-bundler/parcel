const value = require('./value');
output = () => import('./entry').then(m => m.value + value);
