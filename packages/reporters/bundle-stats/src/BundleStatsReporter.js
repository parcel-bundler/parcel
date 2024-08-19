// @flow strict-local

import type {PackagedBundle, PluginOptions} from '@atlaspack/types';

import {Reporter} from '@atlaspack/plugin';
import {DefaultMap} from '@atlaspack/utils';

import assert from 'assert';
import path from 'path';

export type AssetStat = {|
  size: number,
  name: string,
  bundles: Array<string>,
|};

export type BundleStat = {|
  size: number,
  id: string,
  assets: Array<string>,
|};

export type BundleStats = {|
  bundles: {[key: string]: BundleStat},
  assets: {[key: string]: AssetStat},
|};

export default (new Reporter({
  async report({event, options}) {
    if (event.type !== 'buildSuccess') {
      return;
    }

    let bundlesByTarget: DefaultMap<
      string /* target name */,
      Array<PackagedBundle>,
    > = new DefaultMap(() => []);
    for (let bundle of event.bundleGraph.getBundles()) {
      bundlesByTarget.get(bundle.target.name).push(bundle);
    }

    let reportsDir = path.join(options.projectRoot, 'atlaspack-bundle-reports');
    await options.outputFS.mkdirp(reportsDir);

    await Promise.all(
      [...bundlesByTarget.entries()].map(([targetName, bundles]) =>
        options.outputFS.writeFile(
          path.join(reportsDir, `${targetName}-stats.json`),
          JSON.stringify(getBundleStats(bundles, options), null, 2),
        ),
      ),
    );
  },
}): Reporter);

export function getBundleStats(
  bundles: Array<PackagedBundle>,
  options: PluginOptions,
): BundleStats {
  let bundlesByName = new Map<string, BundleStat>();
  let assetsById = new Map<string, AssetStat>();

  // let seen = new Map();

  for (let bundle of bundles) {
    let bundleName = path.relative(options.projectRoot, bundle.filePath);

    // If we've already seen this bundle, we can skip it... right?
    if (bundlesByName.has(bundleName)) {
      // Sanity check: this is the same bundle, right?
      assert(bundlesByName.get(bundleName)?.size === bundle.stats.size);
      continue;
    }

    let assets = [];
    bundle.traverseAssets(({id, filePath, stats: {size}}) => {
      assets.push(id);
      let assetName = path.relative(options.projectRoot, filePath);
      if (assetsById.has(id)) {
        assert(assetsById.get(id)?.name === assetName);
        assert(assetsById.get(id)?.size === size);
        assetsById.get(id)?.bundles.push(bundleName);
      } else {
        assetsById.set(id, {name: assetName, size, bundles: [bundleName]});
      }
    });

    bundlesByName.set(bundleName, {
      id: bundle.id,
      size: bundle.stats.size,
      assets,
    });
  }

  return {
    bundles: Object.fromEntries(bundlesByName),
    assets: Object.fromEntries(assetsById),
  };
}
