module.exports = function(fn) {
  return function(...args) {
    return new Promise(function(resolve, reject) {
      fn(...args, function(err, ...res) {
        if (err) return reject(err);

        if (res.length === 1) return resolve(res[0]);

        resolve(res);
      });
    });
  };
};
