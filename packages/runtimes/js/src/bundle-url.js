/* globals document:readonly */

var bundleURL = {};
function getBundleURLCached(id) {
  let value = bundleURL[id];
  if (!value) {
    value = getBundleURL();
    bundleURL[id] = value;
  }

  return value;
}

function getBundleURL() {
  // Attempt to find the URL of the current script and use that as the base URL
  if (process.env.PARCEL_BUILD_ENV === 'test') {
    if (typeof document !== 'undefined' && 'currentScript' in document) {
      console.log(
        'returning getbaseurl:',
        getBaseURL(document.currentScript.src),
      );
      return getBaseURL(document.currentScript.src);
    }
  }

  try {
    throw new Error();
  } catch (err) {
    var matches = ('' + err.stack).match(/(https?|file|ftp):\/\/[^)\n]+/g);
    if (matches) {
      // Use the last occurrence so that the URL of the calling bundle is returned, not of the bundling containing this
      console.log('matches:', matches);
      console.log('returning:', getBaseURL(matches[matches.length - 1]));
      return getBaseURL(matches[matches.length - 1]);
    }
  }
  console.log('helloo in getbundurl. returning /');
  return '/';
}

function getBaseURL(url) {
  return (
    ('' + url).replace(/^((?:https?|file|ftp):\/\/.+)\/[^/]+$/, '$1') + '/'
  );
}

// TODO: Replace uses with `new URL(url).origin` when ie11 is no longer supported.
function getOrigin(url) {
  let matches = ('' + url).match(/(https?|file|ftp):\/\/[^/]+/);
  if (!matches) {
    throw new Error('Origin not found');
  }
  return matches[0];
}

exports.getBundleURL = getBundleURLCached;
exports.getBaseURL = getBaseURL;
exports.getOrigin = getOrigin;
