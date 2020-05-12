// @flow
import path from 'path';
import type {BundleGraph, Bundle, Dependency} from '@parcel/types';
import {Reporter} from '@parcel/plugin';

const buildManifest = (bundleGraph: BundleGraph) => {
  const manifest = {};
  const bundles = bundleGraph.getBundles();

  const assets = {};
  bundles.forEach((bundle: Bundle) => {
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
      let resolved = bundleGraph.resolveExternalDependency(dependency, bundle);
      if (resolved == null || resolved.type === 'asset') {
        continue;
      }

      // let bundles = bundleGraph.getBundlesInBundleGroup(resolved);
      // const [entryBundle] = bundles;
      const allBundles = bundleGraph.getBundlesInBundleGroup(resolved.value);
      const jsBundles = allBundles.filter(b => b.type === 'js');
      const entryBundle = jsBundles[jsBundles.length - 1];

      if (!entryBundle) {
        continue;
      }

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

exports.default = new Reporter({
  report({event, options}) {
    if (event.type === 'buildSuccess') {
      const manifest = buildManifest(event.bundleGraph);
      const filePath = path.join(
        options.projectRoot,
        'dist',
        'react-loadable.json',
      );
      return options.outputFS.writeFile(
        filePath,
        JSON.stringify(manifest, null, 2),
      );
    } else {
      return;
    }
  },
});
