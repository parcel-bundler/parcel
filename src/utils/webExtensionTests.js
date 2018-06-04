const path = require('path');
const fs = require('fs');
const logger = require('../Logger');

/**
 * Tests if a given `filename` is a WebExtension `manifest.json` file.
 * @param {string} filename Filename to test.
 * @returns {boolean}
 */
async function isWebExtensionManifest(filename) {
  if (path.basename(filename) !== 'manifest.json') {
    return false;
  }

  try {
    const rawManifest = await fs.readFile(filename, {encoding: 'utf8'});
    const manifestJson = JSON.parse(rawManifest);
    return hasWebExtensionManifestKeys(manifestJson);
  } catch (err) {
    logger.error(`Failed to parse ${filename}: ${err}`);
  }

  return false;
}

/**
 * Tests for presence of mandatory WebExtension manifest keys.
 * @param {object} manifestJson Parsed manifest.json object to test.
 * @returns {boolean}
 */
function hasWebExtensionManifestKeys(manifestJson) {
  const requiredKeys = ['manifest_version', 'name', 'version'];
  const presentKeys = Object.keys(manifestJson).filter(key =>
    requiredKeys.includes(key)
  );
  return presentKeys.length === requiredKeys.length;
}

module.exports = {
  isWebExtensionManifest,
  hasWebExtensionManifestKeys
};
