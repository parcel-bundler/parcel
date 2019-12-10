// @flow

import type {Config} from '@parcel/types';
import type {BabelTargets} from './types';

import presetEnv from '@babel/preset-env';

import getBabelTargets from './getBabelTargets';
import {enginesToBabelTargets} from './utils';

/**
 * Generates a @babel/preset-env config for an asset.
 * This is done by finding the source module's target engines, and the app's
 * target engines, and doing a diff to include only the necessary plugins.
 */
export default async function getEnvOptions(config: Config) {
  // Load the target engines for the app and generate a @babel/preset-env config
  let appBabelTargets = enginesToBabelTargets(config.env);

  // If this is the app module, the source and target will be the same, so just compile everything.
  // Otherwise, load the source engines and generate a babel-present-env config.
  if (!config.isSource) {
    let sourceBabelTargets = await getBabelTargets(config);

    if (
      !sourceBabelTargets ||
      !shouldCompileFurther(sourceBabelTargets, appBabelTargets)
    ) {
      return null;
    }
  }

  return {
    targets: appBabelTargets,
    presets: [
      [
        '@parcel/babel-preset-env',
        {
          useBuiltIns: 'entry',
          corejs: 3,
          shippedProposals: true,
          ignoreBrowserslistConfig: true,
          targets: appBabelTargets,
        },
      ],
    ],
  };
}

function getNeededPlugins(targets: BabelTargets): Array<mixed> {
  return presetEnv(
    {assertVersion: () => true},
    {targets: targets},
  ).plugins.filter(p => p[0]);
}

function shouldCompileFurther(
  sourceBabelTargets: BabelTargets,
  appBabelTargets: BabelTargets,
): boolean {
  let sourcePlugins = new Set(getNeededPlugins(sourceBabelTargets));
  let appPlugins = getNeededPlugins(appBabelTargets);

  // If there is any app plugin present that was not used to compile the source,
  // then the asset was built to a higher target and will need to be compiled
  // further
  return appPlugins.some(plugin => {
    return !sourcePlugins.has(plugin);
  });
}
