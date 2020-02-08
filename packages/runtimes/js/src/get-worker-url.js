/* global self, Blob */

var bundleUrl = require('./bundle-url');

module.exports = function loadWorker(relativePath) {
  var workerUrl = bundleUrl.getBundleURL() + relativePath;
  if (bundleUrl.getOrigin(workerUrl) === self.location.origin) {
    // If the worker bundle's url is on the same origin as the document,
    // use the worker bundle's own url.
    return workerUrl;
  } else {
    // Otherwise, create a blob URL which loads the worker bundle with `importScripts`.
    return URL.createObjectURL(
      new Blob(['importScripts(' + JSON.stringify(workerUrl) + ');']),
    );
  }
};
