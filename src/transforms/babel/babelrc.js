const {buildRootChain} = require('@babel/core/lib/config/config-chain');
const {mergeOptions} = require('@babel/core/lib/config/util');
const semver = require('semver');
const logger = require('../../logger');
const path = require('path');
const promisify = require('../../utils/promisify');
const resolve = promisify(require('resolve'));
const installPackage = require('../../utils/installPackage');

async function getBabelConfig(asset, isSource) {
  let config = await getBabelRc(asset, isSource);
  if (!config) {
    return null;
  }

  // Ignore if the config is empty.
  if ((!config.plugins || config.plugins.length === 0) ||
    (!config.presets || config.presets.length === 0)) {
    return null;
  }

  let babelVersion = await getBabelVersion(asset, config);
  
  return {
    babelVersion,
    config
  };
}

module.exports = getBabelConfig;

/**
 * Finds a .babelrc for an asset. By default, .babelrc files inside node_modules are not used.
 * However, there are some exceptions:
 *   - if `browserify.transforms` includes "babelify" in package.json (for legacy module compat)
 *   - the `source` field in package.json is used by the resolver
 */
async function getBabelRc(asset, isSource) {
  // Support legacy browserify packages
  let pkg = await asset.getPackage();
  let browserify = pkg && pkg.browserify;
  if (browserify && Array.isArray(browserify.transform)) {
    // Look for babelify in the browserify transform list
    let babelify = browserify.transform.find(
      t => (Array.isArray(t) ? t[0] : t) === 'babelify'
    );

    // If specified as an array, override the config with the one specified
    if (Array.isArray(babelify) && babelify[1]) {
      return babelify[1];
    }

    // Otherwise, return the .babelrc if babelify was found
    return babelify ? await findBabelRc(asset) : null;
  }

  // If this asset is not in node_modules, always use the .babelrc
  if (isSource) {
    return await findBabelRc(asset);
  }

  // Otherwise, don't load .babelrc for node_modules.
  // See https://github.com/parcel-bundler/parcel/issues/13.
  return null;
}

async function findBabelRc(asset) {
  // TODO: support babelignore, etc.
  return await asset.getConfig(['.babelrc', '.babelrc.js'], {
    packageKey: 'babel'
  });
}

async function getBabelVersion(asset, babelrc) {
  // Check the package.json to determine the babel version that is installed
  let pkg = await asset.getPackage();
  let babelLegacy = getDependency(pkg, 'babel-core');
  let babelModern = getDependency(pkg, '@babel/core');

  if (babelModern) {
    return getMaxMajor(babelModern);
  }

  if (babelLegacy) {
    return 6;
  }

  // No version was installed. This is either an old app where we didn't require a version to be installed,
  // or a new app that just added a .babelrc without manually installing a version of babel core.
  // We will attempt to infer a verison of babel and install it based on the dependencies of the plugins
  // in the config. This should only happen once since we save babel core into package.json for subsequent runs.
  let inferred = await inferBabelVersion(asset, babelrc);
  let name = inferred === 6 ? 'babel-core' : `@babel/core`;
  await installPackage([name], asset.name);
  return inferred;
}

function getDependency(pkg, dep) {
  return (
    (pkg.dependencies && pkg.dependencies[dep]) ||
    (pkg.peerDependencies && pkg.peerDependencies[dep]) ||
    (pkg.devDependencies && pkg.devDependencies[dep])
  );
}

// Core babel packages we use to infer the major version of babel to use.
const CORE_DEPS = new Set([
  '@babel/core',
  '@babel/runtime', 
  '@babel/template',
  '@babel/parser',
  'babel-core',
  'babel-runtime',
  'babel-template',
  'babylon'
]);

async function inferBabelVersion(asset, babelrc) {
  // Attempt to determine version based on dependencies of plugins
  let basedir = path.dirname(asset.name);
  let presets = (babelrc.presets || []).map(p => resolveModule('preset', getPluginName(p), basedir));
  let plugins = (babelrc.plugins || []).map(p => resolveModule('plugin', getPluginName(p), basedir));
  let results = await Promise.all([...presets, ...plugins]);
  let version;

  for (let pkg of results) {
    if (!pkg) {
      continue;
    }

    for (let name of CORE_DEPS) {
      let dep = getDependency(pkg, name);
      if (dep) {
        // Parse version range (ignore prerelease), and ensure it overlaps with the existing version (if any)
        let range = new semver.Range(dep.replace(/-.*(\s|\|\||$)?/, ''));
        if (version && !version.intersects(range)) {
          throw new Error('Conflicting babel versions found in .babelrc. Make sure all of your plugins and presets depend on the same major version of babel.');
        }

        version = range;
        break;
      }
    }
  }

  // Find the maximum major version allowed in the range and use that.
  // e.g. if ^6 || ^7 were specified, use 7.
  version = getMaxMajor(version);
  if (!version) {
    logger.warn(`Could not infer babel version. Defaulting to babel 7. Please add either babel-core or @babel/core as a dependency.`);
    version = 7;
  }

  return version;
}

function getPluginName(p) {
  return Array.isArray(p) ? p[0] : p;
}

function getMaxMajor(version) {
  try {
    let range = new semver.Range(version);
    let sorted = range.set.sort((a, b) => a[0].semver.compare(b[0].semver));
    return semver.major(sorted.pop()[0].semver.version);
  } catch (err) {
    return null;
  }
}

async function resolveModule(type, name, basedir) {
  try {
    name = standardizeName(type, name);
    return await resolve(name, {basedir}).then(([name, pkg]) => pkg);
  } catch (err) {
    return null;
  }
}

// Copied from https://github.com/babel/babel/blob/3a399d1eb907df520f2b85bf9ddbc6533e256f6d/packages/babel-core/src/config/files/plugins.js#L61

const EXACT_RE = /^module:/;
const BABEL_PLUGIN_PREFIX_RE = /^(?!@|module:|[^/]+\/|babel-plugin-)/;
const BABEL_PRESET_PREFIX_RE = /^(?!@|module:|[^/]+\/|babel-preset-)/;
const BABEL_PLUGIN_ORG_RE = /^(@babel\/)(?!plugin-|[^/]+\/)/;
const BABEL_PRESET_ORG_RE = /^(@babel\/)(?!preset-|[^/]+\/)/;
const OTHER_PLUGIN_ORG_RE = /^(@(?!babel\/)[^/]+\/)(?![^/]*babel-plugin(?:-|\/|$)|[^/]+\/)/;
const OTHER_PRESET_ORG_RE = /^(@(?!babel\/)[^/]+\/)(?![^/]*babel-preset(?:-|\/|$)|[^/]+\/)/;
const OTHER_ORG_DEFAULT_RE = /^(@(?!babel$)[^/]+)$/;

function standardizeName(type, name) {
  // Let absolute and relative paths through.
  if (path.isAbsolute(name)) return name;

  const isPreset = type === "preset";

  return (
    name
      // foo -> babel-preset-foo
      .replace(
        isPreset ? BABEL_PRESET_PREFIX_RE : BABEL_PLUGIN_PREFIX_RE,
        `babel-${type}-`,
      )
      // @babel/es2015 -> @babel/preset-es2015
      .replace(
        isPreset ? BABEL_PRESET_ORG_RE : BABEL_PLUGIN_ORG_RE,
        `$1${type}-`,
      )
      // @foo/mypreset -> @foo/babel-preset-mypreset
      .replace(
        isPreset ? OTHER_PRESET_ORG_RE : OTHER_PLUGIN_ORG_RE,
        `$1babel-${type}-`,
      )
      // @foo -> @foo/babel-preset
      .replace(OTHER_ORG_DEFAULT_RE, `$1/babel-${type}`)
      // module:mypreset -> mypreset
      .replace(EXACT_RE, "")
  );
}
