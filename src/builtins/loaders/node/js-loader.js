var fs = require('fs');

module.exports = function loadJSBundle(bundle) {
  return new Promise(function(resolve, reject) {
    fs.readFile(__dirname + bundle, 'utf8', function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  })
  .then(function(code) {
    new Function('', code)();
  });
};
