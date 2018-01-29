const browserslist = require('browserslist');
const semver = require('semver');

/**
 * Loads target node and browser versions from the following locations:
 *   - package.json engines field
 *   - package.json browserslist field
 *   - browserslist or .browserslistrc files
 *   - .babelrc or .babelrc.js files with babel-preset-env
 */
async function getTargetEngines(asset, isTarget, path) {
  let targets = {};
  let pkg = await asset.getConfig(['package.json'], {path});

  // Only use engines in node_modules, not the target app
  let engines = pkg && !isTarget ? pkg.engines : null;
  let nodeVersion = engines && getMinSemver(engines.node);
  if (typeof nodeVersion === 'string') {
    targets.node = nodeVersion;
  }

  if (
    engines &&
    (typeof engines.browsers === 'string' || Array.isArray(engines.browsers))
  ) {
    targets.browsers = engines.browsers;
  } else if (pkg && pkg.browserslist) {
    targets.browsers = pkg.browserslist;
  } else {
    let browserslist = await loadBrowserslist(asset, path);
    if (browserslist) {
      targets.browsers = browserslist;
    } else {
      let babelTargets = await loadBabelrc(asset, path);
      Object.assign(targets, babelTargets);
    }
  }

  if (Object.keys(targets).length === 0) {
    return null;
  }

  if (targets.browsers) {
    targets.browsers = browserslist(targets.browsers).sort();
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

async function loadBrowserslist(asset, path) {
  let config = await asset.getConfig(['browserslist', '.browserslistrc'], {
    path,
    load: false
  });
  if (config) {
    let browserslist = browserslist.readConfig(config);
    if (typeof browserslist === 'object' && !Array.isArray(browserslist)) {
      browserslist = browserslist[process.env.NODE_ENV];
    }

    return browserslist;
  }
}

async function loadBabelrc(asset, path) {
  let config = await asset.getConfig(['.babelrc', '.babelrc.js'], {path});
  if (config && config.presets) {
    let env = config.presets.find(
      plugin =>
        Array.isArray(plugin) &&
        (plugin[0] === 'env' || plugin[0] === '@babel/env')
    );
    if (env && env[1].targets) {
      return env[1].targets;
    }
  }
}

module.exports = getTargetEngines;
