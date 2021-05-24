// @flow strict-local

import type {PackagedBundle, Target} from '@parcel/types';

import path from 'path';
import {Reporter} from '@parcel/plugin';

export default (new Reporter({
  async report({event, options}) {
    if (event.type !== 'buildSuccess' || options.mode !== 'production') {
      return;
    }

    let bundleGraph = event.bundleGraph;
    let entryBundlesByTarget: Map<
      string,
      {|target: Target, entryBundles: Set<PackagedBundle>|},
    > = new Map();
    bundleGraph.traverseBundles((bundle, _, actions) => {
      let res = entryBundlesByTarget.get(bundle.target.name);
      if (res == null) {
        res = {
          target: bundle.target,
          entryBundles: new Set(),
        };
        entryBundlesByTarget.set(bundle.target.name, res);
      }
      res.entryBundles.add(bundle);
      actions.skipChildren();
    });

    await Promise.all(
      Array.from(entryBundlesByTarget).map(
        async ([, {target, entryBundles}]) => {
          if (target.stableEntries) {
            return;
          }

          let manifest = {};
          for (let entryBundle of entryBundles) {
            let mainEntry = entryBundle.getMainEntry();
            if (mainEntry != null) {
              manifest[path.basename(mainEntry.filePath)] = bundleGraph
                .getReferencedBundles(entryBundle)
                .concat([entryBundle])
                .map(b => b.filePath);
            }
          }

          await options.outputFS.writeFile(
            path.join(target.distDir, 'parcel-manifest.json'),
            JSON.stringify(manifest, null, 2),
          );
        },
      ),
    );
  },
}): Reporter);
