const value = require('./value');
module.exports = () =>
  import('./first')
    .then(m => m.run())
    .then(result => result + value);
