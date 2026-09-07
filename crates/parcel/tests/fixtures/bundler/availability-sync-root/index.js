const value = require('./value');
const eager = require('./eager');
module.exports = () =>
  import('./eager').then(m => [value, eager.value, m.value]);
