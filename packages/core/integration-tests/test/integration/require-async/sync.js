module.exports = new Promise(resolve => {
  let b = require('./async');
  resolve(b + 3);
});
