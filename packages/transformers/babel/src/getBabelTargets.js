// @flow

import type {Config} from '@parcel/types';
import type {BabelTargets} from './types';

import browserslist from 'browserslist';
import semver from 'semver';

const BROWSER_CONTEXT = new Set(['browser', 'web-worker', 'service-worker']);

// https://github.com/browserslist/browserslist/blob/04d7b3cc6ebeb62baf6d62aeb90f1bfd0c11117c/test/config.test.js#L23
type BrowserslistConfig = {|[string]: string | Array<string>|};

/**
 * Loads target node and browser versions from the following locations:
 *   - package.json engines field
 *   - package.json browserslist field
 *   - browserslist or .browserslistrc files
 *
 * "Targets" is the name @babel/preset-env uses for what Parcel calls engines.
 * This should not be confused with Parcel's own targets.
 * Unlike Parcel's engines, @babel/preset-env expects to work with minimum
 * versions, not semver ranges, of its targets.
 */
export default async function getBabelTargets(
  config: Config,
): Promise<?BabelTargets> {
  let targets = {};
  let compileTarget = BROWSER_CONTEXT.has(config.env.context)
    ? 'browsers'
    : config.env.context;
  let pkg = await config.getPackage();
  let packageEngines = pkg?.engines;

  if (compileTarget === 'node') {
    let nodeVersion = packageEngines?.node;
    // Use package.engines.node by default if we are compiling for node.
    if (typeof nodeVersion === 'string') {
      try {
        //$FlowFixMe catch error when minVersion() returned null
        targets.node = semver.minVersion(nodeVersion).version;
      } catch (e) {
        throw new Error("Expected 'node' engine to be a valid Semver Range");
      }
    }
  } else {
    let browsers;
    if (
      packageEngines &&
      (typeof packageEngines.browsers === 'string' ||
        Array.isArray(packageEngines.browsers))
    ) {
      browsers = packageEngines.browsers;
    } else if (pkg && pkg.browserslist) {
      browsers = pkg.browserslist;
    } else {
      let browserslist = await loadBrowserslist(config);
      if (browserslist) {
        browsers = browserslist;
      }
    }

    // Parse browser targets
    if (
      typeof browsers === 'object' &&
      browsers != null &&
      !Array.isArray(browsers)
    ) {
      let env = process.env.NODE_ENV || 'development';
      browsers = browsers[env] || browsers.defaults;
    }

    if (browsers) {
      targets.browsers = browserslist(browsers).sort();
    }
  }

  // Dont compile if we couldn't find any targets
  if (Object.keys(targets).length === 0) {
    return null;
  }

  return targets;
}

async function loadBrowserslist(config): Promise<?BrowserslistConfig> {
  let browserslistConfig = await config.getConfig(
    ['browserslist', '.browserslistrc'],
    {
      parse: false,
    },
  );

  if (browserslistConfig) {
    return browserslist.parseConfig(browserslistConfig.contents);
  }
}
