// @flow

export default function<T: Function>(fn: T): T {
  declare var promisify: T;

  return promisify;

  function promisify(...args) {
    return new Promise(function(resolve, reject) {
      fn(...args, function(err, ...res) {
        if (err) return reject(err);

        if (res.length === 1) return resolve(res[0]);

        resolve(res);
      });
    });
  }
}
