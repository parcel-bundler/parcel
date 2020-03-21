/* global importScripts:readonly*/
const cacheLoader = require('../../cacheLoader');

module.exports = cacheLoader(function loadJSBundle(bundle) {
  return new Promise(function(resolve, reject) {
    try {
      importScripts(bundle);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
});
