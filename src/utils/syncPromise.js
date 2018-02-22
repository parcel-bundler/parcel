const deasync = require('deasync');

/**
 * Synchronously waits for a promise to return by
 * yielding to the node event loop as needed.
 */
function syncPromise(promise) {
  let isDone = false;
  let res, err;

  promise.then(
    value => {
      res = value;
      isDone = true;
    },
    error => {
      err = error;
      isDone = true;
    }
  );

  deasync.loopWhile(() => !isDone);

  if (err) {
    throw err;
  }

  return res;
}

module.exports = syncPromise;
