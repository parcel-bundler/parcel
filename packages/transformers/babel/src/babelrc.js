// @flow
import type {MutableAsset, PackageJSON} from '@parcel/types';
import micromatch from 'micromatch';

export default async function getBabelConfig(
  asset: MutableAsset,
  pkg: ?PackageJSON,
  isSource: boolean
) {
  let config = await getBabelRc(asset, pkg, isSource);
  if (!config) {
    return null;
  }

  // Ignore if the config is empty.
  if (
    (!config.plugins || config.plugins.length === 0) &&
    (!config.presets || config.presets.length === 0)
  ) {
    return null;
  }

  let babelVersion = await getBabelVersion();

  return {
    babelVersion,
    config
  };
}

/**
 * Finds a .babelrc for an asset. By default, .babelrc files inside node_modules are not used.
 * However, there are some exceptions:
 *   - the `source` field in package.json is used by the resolver
 */
async function getBabelRc(asset, pkg, isSource) {
  // If this asset is not in node_modules, always use the .babelrc
  if (isSource) {
    return findBabelRc(asset);
  }

  // Otherwise, don't load .babelrc for node_modules.
  // See https://github.com/parcel-bundler/parcel/issues/13.
  return null;
}

async function findBabelRc(asset) {
  // TODO: use the babel API to do this config resolution and support all of its features.
  // This is not currently possible because babel tries to actually load plugins and presets
  // while resolving the config, but those plugins might not be installed yet.
  let config = await asset.getConfig(['.babelrc', '.babelrc.js'], {
    packageKey: 'babel'
  });

  if (!config) {
    return null;
  }

  if (typeof config === 'function') {
    // We cannot support function configs since there is no exposed method in babel
    // to create the API that is passed to them...
    throw new Error(
      'Parcel does not support function configs in .babelrc.js yet.'
    );
  }

  for (let key of ['extends', 'overrides', 'test', 'include', 'exclude']) {
    if (config[key]) {
      throw new Error(
        `Parcel does not support babel 7 advanced configuration option "${key}" yet.`
      );
    }
  }

  // Support ignore/only config options.
  if (shouldIgnore(asset, config)) {
    return null;
  }

  // Support .babelignore
  let ignoreConfig = await getIgnoreConfig(asset);
  if (ignoreConfig && shouldIgnore(asset, ignoreConfig)) {
    return null;
  }

  return config;
}

async function getIgnoreConfig(asset) {
  let ignore: string | null = await asset.getConfig(['.babelignore'], {
    parse: false
  });

  if (!ignore) {
    return null;
  }

  let patterns = ignore
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean);

  return {ignore: patterns};
}

function shouldIgnore(asset, config) {
  if (config.ignore && matchesPatterns(config.ignore, asset.filePath)) {
    return true;
  }

  // $FlowFixMe
  if (config.only && !matchesPatterns(config.only, asset.filePath)) {
    return true;
  }

  return false;
}

function matchesPatterns(patterns, path) {
  return patterns.some(pattern => {
    if (typeof pattern === 'function') {
      return !!pattern(path);
    }

    if (typeof pattern === 'string') {
      return micromatch.isMatch(path, '**/' + pattern + '/**');
    }

    return pattern.test(path);
  });
}

async function getBabelVersion() {
  return 7;
}
