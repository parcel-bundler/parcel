// @flow
import path from 'path';
import type {BundleGraph, NamedBundle, Dependency, Target} from '@parcel/types';
import {Reporter} from '@parcel/plugin';
import nullthrows from 'nullthrows';

const manifest = {};
const buildManifest = (
  bundles: Set<NamedBundle>,
  bundleGraph: BundleGraph<NamedBundle>,
) => {
  const assets = {};
  bundles.forEach((bundle: NamedBundle) => {
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
      const {name, id} = bundle;

      if (!manifest[key]) {
        manifest[key] = [];
      }

      manifest[key].push({
        id: id,
        name,
        file: name,
        publicPath: name,
      });
    }
  });

  return manifest;
};

exports.default = (new Reporter({
  async report({event, options}) {
    if (options.mode == 'development' && !options.env.PARCEL_REACT_LOADABLE) {
      return;
    }
    if (event.type !== 'buildSuccess') {
      return;
    }

    let bundleGraph = event.bundleGraph;
    let entryBundlesByTarget: Map<
      string,
      {|target: Target, entryBundles: Set<NamedBundle>|},
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
