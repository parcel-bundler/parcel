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
    if (!bundle.env.isBrowser() || bundle.env.isWorklet()) {
      return;
    }
    if (bundle.name == 'manifest.json') {
      const asset = bundle.getMainEntry();
      if (asset?.meta.webextEntry !== true) return;

      // Hack to bust packager cache when any descendants update
      const descendants = [];
      bundleGraph.traverseBundles(b => {
        descendants.push(b.id);
      }, bundle);
      return {
        filePath: __filename,
        code: JSON.stringify(descendants),
        isEntry: true,
      };
    } else if (options.hmrOptions && bundle.type == 'js') {
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
      if (bundle === firstInsertableBundle) {
        return {
          filePath: __filename,
          code:
            `var HMR_HOST = ${JSON.stringify(
              options.hmrOptions?.host ?? 'localhost',
            )};` +
            `var HMR_PORT = '${options.hmrOptions?.port ?? ''}';` +
            AUTORELOAD_BG,
          isEntry: true,
        };
      }
    }
  },
}): Runtime);
