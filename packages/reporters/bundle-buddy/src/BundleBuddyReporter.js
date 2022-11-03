// @flow strict-local
import type {PackagedBundle} from '@parcel/types';
import {Reporter} from '@parcel/plugin';
import path from 'path';

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
      let out = [];

      for (let bundle of bundles) {
        bundle.traverseAssets(asset => {
          let deps = event.bundleGraph.getDependencies(asset);
          for (let dep of deps) {
            let resolved = event.bundleGraph.getResolvedAsset(dep);
            if (!resolved) {
              continue;
            }

            out.push({
              source: path.relative(options.projectRoot, asset.filePath),
              target: path.relative(options.projectRoot, resolved.filePath),
            });
          }
        });
      }

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
