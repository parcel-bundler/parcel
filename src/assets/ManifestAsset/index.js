const isWebExtensionManifest = require('../../utils/isWebExtensionManifest');

function resolveManifestAsset(filename) {
  if (isWebExtensionManifest(filename)) {
    return require('./WebExtensionManifestAsset');
  }

  return require('./WebManifestAsset');
}

module.exports = resolveManifestAsset;
