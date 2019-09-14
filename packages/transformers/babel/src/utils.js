// @flow

import type {Environment} from '@parcel/types';
import type {BabelTargets} from './types';

import invariant from 'assert';
import semver from 'semver';

export function enginesToBabelTargets(env: Environment): BabelTargets {
  // "Targets" is the name @babel/preset-env uses for what Parcel calls engines.
  // This should not be confused with Parcel's own targets.
  // Unlike Parcel's engines, @babel/preset-env expects to work with minimum
  // versions, not semver ranges, of its targets.
  let targets = {};
  for (let engineName of Object.keys(env.engines)) {
    let engineValue = env.engines[engineName];

    // if the engineValue is a string, it might be a semver range. Use the minimum
    // possible version instead.
    if (engineName === 'browsers') {
      targets[engineName] = engineValue;
    } else {
      invariant(typeof engineValue === 'string');
      let minVersion = getMinSemver(engineValue);
      targets[engineName] = minVersion ?? engineValue;
    }
  }

  if (env.isModule && env.isBrowser()) {
    targets.esmodules = true;
    delete targets.browsers;
  }

  return targets;
}

// TODO: Replace with `minVersion` (https://github.com/npm/node-semver#ranges-1)
//       once semver has been upgraded across Parcel.
export function getMinSemver(version: string) {
  try {
    let range = new semver.Range(version);
    let sorted = range.set.sort((a, b) => a[0].semver.compare(b[0].semver));
    return sorted[0][0].semver.version;
  } catch (err) {
    return null;
  }
}
