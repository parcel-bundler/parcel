// @flow strict-local
import type {
  BundleGraph,
  Bundle,
  PackagedBundle,
  PluginOptions,
} from '@parcel/types';
import {Reporter} from '@parcel/plugin';
import path from 'path';

export type BundleBuddyReport = Array<{|source: string, target: string|}>;

export default (new Reporter({
  async report({event, options, logger}) {
    if (event.type !== 'buildSuccess') {
      return;
    }

    let bundlesByTarget: Map<string, Array<PackagedBundle>> = new Map();
    for (let bundle of event.bundleGraph.getBundles()) {
      let bundles = bundlesByTarget.get(bundle.target.distDir);
      if (!bundles) {
        bundles = [];
        bundlesByTarget.set(bundle.target.distDir, bundles);
      }

      bundles.push(bundle);
    }

    for (let [targetDir, bundles] of bundlesByTarget) {
      let out = getBundleBuddyReport(event.bundleGraph, bundles, options);

      await options.outputFS.writeFile(
        path.join(targetDir, 'bundle-buddy.json'),
        JSON.stringify(out),
      );
      logger.info({
        message: `Wrote report to ${path.relative(
          options.outputFS.cwd(),
          path.join(targetDir, 'bundle-buddy.json'),
        )}`,
      });
    }
  },
}): Reporter);

export function getBundleBuddyReport<TBundle: Bundle>(
  bundleGraph: BundleGraph<TBundle>,
  bundles: Array<TBundle>,
  {projectRoot}: PluginOptions,
): BundleBuddyReport {
  let out = [];

  for (let bundle of bundles) {
    bundle.traverseAssets(asset => {
      let deps = bundleGraph.getDependencies(asset);
      for (let dep of deps) {
        let resolved = bundleGraph.getResolvedAsset(dep);
        if (!resolved) {
          continue;
        }

        out.push({
          source: path.relative(projectRoot, asset.filePath),
          target: path.relative(projectRoot, resolved.filePath),
        });
      }
    });
  }

  return out;
}
