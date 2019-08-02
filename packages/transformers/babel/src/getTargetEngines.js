// @flow

import type {Engines, Config} from '@parcel/types';

import browserslist from 'browserslist';

const BROWSER_CONTEXT = new Set(['browser', 'web-worker', 'service-worker']);

/**
 * Loads target node and browser versions from the following locations:
 *   - package.json engines field
 *   - package.json browserslist field
 *   - browserslist or .browserslistrc files
 */
export default async function getTargetEngines(config: Config): Engines {
  let targets = {};
  let compileTarget = BROWSER_CONTEXT.has(config.env.context)
    ? 'browsers'
    : config.env.context;
  let pkg = await config.getPackage();
  let engines = pkg && pkg.engines;

  if (compileTarget === 'node') {
    let nodeVersion = engines?.node;
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
      let browserslist = await loadBrowserslist(config);
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
      // let env = asset.options.production
      //   ? 'production'
      //   : process.env.NODE_ENV || 'development';
      let env = process.env.NODE_ENV || 'development';
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

async function loadBrowserslist(config) {
  let browserslistConfig = await config.getConfig(
    ['browserslist', '.browserslistrc'],
    {
      parse: false
    }
  );

  if (browserslistConfig) {
    return browserslist.parseConfig(browserslistConfig);
  }
}
