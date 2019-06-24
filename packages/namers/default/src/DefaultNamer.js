// @flow strict-local

import type {Bundle, FilePath} from '@parcel/types';

import {Namer} from '@parcel/plugin';
import assert from 'assert';
import crypto from 'crypto';
import path from 'path';

const COMMON_NAMES = new Set(['index', 'src', 'lib']);

export default new Namer({
  name({bundle, bundleGraph, options}) {
    // If the bundle has an explicit file path given (e.g. by a target), use that.
    if (bundle.filePath != null) {
      // TODO: what about multiple assets in the same dep?
      // e.g. input is a Vue file, output is JS + CSS
      // which is defined as a target in package.json?
      return bundle.filePath;
    }

    let bundleGroupBundles = bundleGraph.getBundlesInBundleGroup(
      bundleGraph.getBundleGroupsContainingBundle(bundle)[0]
    );

    if (bundle.isEntry) {
      let entryBundlesOfType = bundleGroupBundles.filter(
        b => b.isEntry && b.type === bundle.type
      );
      assert(
        entryBundlesOfType.length === 1,
        // Otherwise, we'd end up naming two bundles the same thing.
        'Bundle group cannot have more than one entry bundle of the same type'
      );
    }

    let firstBundleInGroup = bundleGroupBundles[0];
    if (
      bundle.id === firstBundleInGroup.id &&
      bundle.isEntry &&
      bundle.target &&
      bundle.target.distEntry != null
    ) {
      return bundle.target.distEntry;
    }

    // Base split bundle names on the first bundle in their group.
    // e.g. if `index.js` imports `foo.css`, the css bundle should be called
    //      `index.css`.
    let name = nameFromContent(firstBundleInGroup, options.rootDir);
    if (!bundle.isEntry) {
      name += '.' + getHash(bundle).slice(-8);
    }
    return name + '.' + bundle.type;
  }
});

function nameFromContent(bundle: Bundle, rootDir: FilePath): string {
  let entryAsset = bundle.getEntryAssets()[0];
  let entryFilePath = entryAsset.filePath;
  let name = path.basename(entryFilePath, path.extname(entryFilePath));

  // If this is an entry bundle, use the original relative path.
  if (bundle.isEntry) {
    return path
      .join(path.relative(rootDir, path.dirname(entryFilePath)), name)
      .replace(/\.\.(\/|\\)/g, '__$1');
  } else {
    // If this is an index file or common directory name, use the parent
    // directory name instead, which is probably more descriptive.
    while (COMMON_NAMES.has(name)) {
      entryFilePath = path.dirname(entryFilePath);
      name = path.basename(entryFilePath);
    }

    return name;
  }
}

function getHash(bundle: Bundle): string {
  let hash = crypto.createHash('md5');
  bundle.traverseAssets(asset => {
    hash.update(asset.outputHash);
  });

  return hash.digest('hex');
}
