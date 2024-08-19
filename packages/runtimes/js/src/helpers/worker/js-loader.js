/* global __atlaspack__importScripts__:readonly*/
const cacheLoader = require('../cacheLoader');

module.exports = cacheLoader(function loadJSBundle(bundle) {
  return new Promise(function (resolve, reject) {
    try {
      __atlaspack__importScripts__(bundle);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
});
