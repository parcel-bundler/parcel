var fs = require('fs');

module.exports = function loadJSBundle(bundle) {
  return new Promise((resolve, reject) => {
    fs.readFile(__dirname + bundle, 'utf8', (err, data) => {
      if (err) {
        reject(err);
      } else {
        // wait for the next event loop iteration, so we are sure
        // the current module is fully loaded
        setImmediate(() => {
          resolve(data);
        });
      }
    });
  })
  .then(code => {
    new Function('', code)();
  });
};
