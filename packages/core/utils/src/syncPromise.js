// @flow strict-local

import deasync from 'deasync';

/**
 * Synchronously waits for a promise to return by
 * yielding to the node event loop as needed.
 */
export default function syncPromise<T>(promise: Promise<T>): T {
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

  // $FlowFixMe this is valid since we wait using deasync above
  return res;
}
