// @flow
import semver from 'semver';

import type {Config, Engines} from '@parcel/types';
import getTargetEngines from './getTargetEngines';

import presetEnv from '@babel/preset-env';

/**
 * Generates a @babel/preset-env config for an asset.
 * This is done by finding the source module's target engines, and the app's
 * target engines, and doing a diff to include only the necessary plugins.
 */
export default async function getEnvOptions(config: Config) {
  // Load the target engines for the app and generate a @babel/preset-env config
  let targetEngines = config.env.engines;
  let envOptions = await getPresetOptions(targetEngines, true);

  // If this is the app module, the source and target will be the same, so just compile everything.
  // Otherwise, load the source engines and generate a babel-present-env config.
  if (!(await config.isSource())) {
    let sourceEngines = await getTargetEngines(config);
    if (!sourceEngines) return null;

    let appPlugins = getEnvPlugins(targetEngines, true);
    let sourcePlugins = getEnvPlugins(sourceEngines, false);

    // Do a diff of the returned plugins. If there are more app plugins then the asset was built to
    // a higher target and will need to be compiled further
    sourcePlugins = new Set(sourcePlugins.map(p => p[0]));
    appPlugins = appPlugins.filter(plugin => {
      return !sourcePlugins.has(plugin[0]);
    });

    if (appPlugins.length === 0) return null;
  }

  return {
    presets: [['@babel/preset-env', envOptions]]
  };
}

function getPresetOptions(engines: Engines, useBuiltIns = false) {
  if (!engines) {
    return null;
  }

  // "Targets" is the name @babel/preset-env uses for what Parcel calls engines.
  // This should not be confused with Parcel's own targets.
  // Unlike Parcel's engines, @babel/preset-env expects to work with minimum
  // versions, not semver ranges, of its targets.
  let targets = {};
  for (let engineName of Object.keys(engines)) {
    let engineValue = engines[engineName];

    // if the engineValue is a string, it might be a semver range. Use the minimum
    // possible version instead.
    if (typeof engineValue === 'string') {
      let minVersion = getMinSemver(engineValue);
      targets[engineName] = minVersion ?? engineValue;
    } else {
      targets[engineName] = engineValue;
    }
  }

  return {
    targets,
    modules: false,
    useBuiltIns: useBuiltIns ? 'entry' : false,
    corejs: 3,
    shippedProposals: true
  };
}

function getEnvPlugins(engines: Engines, useBuiltIns = false) {
  let envOptions = getPresetOptions(engines, useBuiltIns);

  let {plugins} = presetEnv({assertVersion: () => true}, envOptions);

  return plugins;
}

// TODO: Replace with `minVersion` (https://github.com/npm/node-semver#ranges-1)
//       once semver has been upgraded across Parcel.
function getMinSemver(version) {
  try {
    let range = new semver.Range(version);
    let sorted = range.set.sort((a, b) => a[0].semver.compare(b[0].semver));
    return sorted[0][0].semver.version;
  } catch (err) {
    return null;
  }
}
