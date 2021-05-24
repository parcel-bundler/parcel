// @flow
import path from 'path';
import type {
  BundleGraph,
  PackagedBundle,
  Dependency,
  Target,
} from '@parcel/types';
import {Reporter} from '@parcel/plugin';
import nullthrows from 'nullthrows';

const manifest = {};
const buildManifest = (
  bundles: Set<PackagedBundle>,
  bundleGraph: BundleGraph<PackagedBundle>,
) => {
  const assets = {};
  bundles.forEach((bundle: PackagedBundle) => {
    if (bundle.type !== 'js') {
      return;
    }

    let asyncDependencies: Dependency[] = [];
    bundle.traverse(node => {
      if (node.type === 'dependency') {
        asyncDependencies.push(node.value);
      }
    });

    if (asyncDependencies.length < 1) {
      return;
    }

    for (let dependency of asyncDependencies) {
      let resolved = bundleGraph.resolveAsyncDependency(dependency, bundle);
      if (resolved == null || resolved.type === 'asset') {
        continue;
      }

      const allBundles = bundleGraph.getBundlesInBundleGroup(resolved.value);
      const entryBundle = nullthrows(
        allBundles.find(
          b => b.getMainEntry()?.id === resolved.value.entryAssetId,
        ),
      );

      if (!assets[dependency.moduleSpecifier]) {
        assets[dependency.moduleSpecifier] = new Set();
      }

      assets[dependency.moduleSpecifier].add(entryBundle);
    }
  });

  // convert set to array of obj with bundle name as file
  Object.keys(assets).forEach(key => {
    for (let bundle of assets[key]) {
      const {filePath, id} = bundle;

      if (!manifest[key]) {
        manifest[key] = [];
      }

      let fileName = path.basename(filePath);

      manifest[key].push({
        id: id,
        name: fileName,
        file: fileName,
        publicPath: fileName,
      });
    }
  });

  return manifest;
};

exports.default = (new Reporter({
  async report({event, options}) {
    if (
      process.env.NODE_ENV != 'test' &&
      options.mode == 'development' &&
      process.env.PARCEL_REACT_LOADABLE == null
    ) {
      return;
    }
    if (event.type !== 'buildSuccess') {
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
          const manifest = buildManifest(entryBundles, bundleGraph);
          await options.outputFS.writeFile(
            path.join(target.distDir, 'react-loadable.json'),
            JSON.stringify(manifest, null, 2),
          );
        },
      ),
    );
  },
}): Reporter);
