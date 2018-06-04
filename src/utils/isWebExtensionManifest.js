const path = require('path');
const fs = require('fs');
const logger = require('../Logger');

/**
 * Tests if a given `filename` is a WebExtension `manifest.json` file.
 * @param {string} filename Filename to test.
 * @returns {boolean}
 */
function isWebExtensionManifest(filename) {
  if (path.basename(filename) !== 'manifest.json') {
    return false;
  }

  try {
    const manifestFile = fs.readFileSync(filename, {encoding: 'utf8'});
    const json = JSON.parse(manifestFile);

    // Check for presence of mandatory WebManifest keys
    const requiredKeys = ['manifest_version', 'name', 'version'];
    const presentKeys = Object.keys(json).filter(key =>
      requiredKeys.includes(key)
    );
    return presentKeys.length === requiredKeys.length;
  } catch (err) {
    logger.error(`Failed to parse ${filename}: ${err}`);
  }

  return false;
}

module.exports = isWebExtensionManifest;
