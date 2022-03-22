// @flow strict-local

import {Runtime} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import fs from 'fs';
import path from 'path';

const AUTORELOAD_BG = fs.readFileSync(
  path.join(__dirname, 'autoreload-bg.js'),
  'utf8',
);

export default (new Runtime({
  apply({bundle, bundleGraph, options}) {
    if (
      bundle.type != 'js' ||
      !options.hmrOptions ||
      !bundle.env.isBrowser() ||
      bundle.env.isWorklet()
    ) {
      return;
    }
    const manifest = bundleGraph
      .getBundles()
      .find(b => b.getMainEntry()?.meta.webextEntry === true);
    const entry = manifest?.getMainEntry();
    const insertDep = entry?.meta.webextBGInsert;
    if (insertDep == null) return;
    const insertBundle = bundleGraph.getReferencedBundle(
      nullthrows(entry?.getDependencies().find(dep => dep.id === insertDep)),
      nullthrows(manifest),
    );
    let firstInsertableBundle;
    bundleGraph.traverseBundles((b, _, actions) => {
      if (b.type == 'js') {
        firstInsertableBundle = b;
        actions.stop();
      }
    }, insertBundle);

    // Add autoreload
    if (bundle.id === firstInsertableBundle?.id) {
      return {
        filePath: __filename,
        code: AUTORELOAD_BG,
        isEntry: true,
      };
    }
  },
}): Runtime);
