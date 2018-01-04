const path = require('path');
const config = require('./config');
const fs = require('./fs');

const packageFilenames = ['package.json'];
const rootChars = ['/', '~'];
let rootCache;

function isAbsolutePath(location) {
  let startChar = location.substring(0, 1);
  return rootChars.includes(startChar);
}

function isUnixAbsolute(location) {
  if (!rootCache) {
    rootCache = fs.readdirSync('/');
  }
  return rootCache.includes(location.split('/')[1]);
}

function resolveAbsolute(
  location,
  filename,
  fallback = path.dirname(location)
) {
  if (isUnixAbsolute(filename)) {
    return filename;
  }
  filename = filename.substring(1);
  if (location.indexOf('node_modules') >= 0) {
    location = config.resolveSync(location, packageFilenames);
    if (location) {
      return path.join(path.dirname(location), filename);
    }
  }
  return path.join(fallback, filename);
}

exports.isAbsolutePath = isAbsolutePath;
exports.resolveAbsolute = resolveAbsolute;
