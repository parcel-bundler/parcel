// @flow
import type {Asset} from '@parcel/types';
import browserslist from 'browserslist';
import semver from 'semver';

const BROWSER_CONTEXT = new Set(['browser', 'web-worker', 'service-worker']);

/**
 * Loads target node and browser versions from the following locations:
 *   - package.json engines field
 *   - package.json browserslist field
 *   - browserslist or .browserslistrc files
 */
export default async function getTargetEngines(asset: Asset) {
  let targets = {};
  let compileTarget = BROWSER_CONTEXT.has(asset.env.context)
    ? 'browsers'
    : asset.env.context;
  let pkg = await asset.getPackage();
  let engines = pkg && pkg.engines;
  let nodeVersion = engines && engines.node && getMinSemver(engines.node);

  if (compileTarget === 'node') {
    // Use package.engines.node by default if we are compiling for node.
    if (typeof nodeVersion === 'string') {
      targets.node = nodeVersion;
    }
  } else {
    if (
      engines &&
      (typeof engines.browsers === 'string' || Array.isArray(engines.browsers))
    ) {
      targets.browsers = engines.browsers;
    } else if (pkg && pkg.browserslist) {
      targets.browsers = pkg.browserslist;
    } else {
      let browserslist = await loadBrowserslist(asset);
      if (browserslist) {
        targets.browsers = browserslist;
      }
    }
  }

  // Parse browser targets
  if (targets.browsers) {
    if (
      typeof targets.browsers === 'object' &&
      !Array.isArray(targets.browsers)
    ) {
      let env = asset.options.production
        ? 'production'
        : process.env.NODE_ENV || 'development';
      targets.browsers = targets.browsers[env] || targets.browsers.defaults;
    }

    if (targets.browsers) {
      targets.browsers = browserslist(targets.browsers).sort();
    }
  }

  // Dont compile if we couldn't find any targets
  if (Object.keys(targets).length === 0) {
    return null;
  }

  return targets;
}

function getMinSemver(version) {
  try {
    let range = new semver.Range(version);
    let sorted = range.set.sort((a, b) => a[0].semver.compare(b[0].semver));
    return sorted[0][0].semver.version;
  } catch (err) {
    return null;
  }
}

async function loadBrowserslist(asset) {
  let config = await asset.getConfig(['browserslist', '.browserslistrc'], {
    parse: false
  });

  if (config) {
    return browserslist.parseConfig(config);
  }
}
