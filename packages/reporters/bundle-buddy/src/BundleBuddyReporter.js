// @flow strict-local
import type {NamedBundle} from '@parcel/types';
import {Reporter} from '@parcel/plugin';
import path from 'path';

export default (new Reporter({
  async report({event, options}) {
    if (
      event.type !== 'buildSuccess' ||
      process.env.BUNDLE_BUDDY == null ||
      // $FlowFixMe
      process.env.BUNDLE_BUDDY == false
    ) {
      return;
    }

    let bundlesByTarget: Map<string, Array<NamedBundle>> = new Map();
    for (let bundle of event.bundleGraph.getBundles()) {
      if (!bundle.isInline) {
        let bundles = bundlesByTarget.get(bundle.target.distDir);
        if (!bundles) {
          bundles = [];
          bundlesByTarget.set(bundle.target.distDir, bundles);
        }

        bundles.push(bundle);
      }
    }

    for (let [targetDir, bundles] of bundlesByTarget) {
      let out = [];

      for (let bundle of bundles) {
        bundle.traverseAssets(asset => {
          let deps = event.bundleGraph.getDependencies(asset);
          for (let dep of deps) {
            let resolved = event.bundleGraph.getDependencyResolution(dep);
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
        `${targetDir}/bundle-buddy.json`,
        JSON.stringify(out),
      );
    }
  },
}): Reporter);
