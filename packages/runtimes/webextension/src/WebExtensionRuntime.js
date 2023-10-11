// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {replaceURLReferences} from '@parcel/utils';
import nullthrows from 'nullthrows';
import fs from 'fs';
import path from 'path';

const AUTORELOAD_BG = fs.readFileSync(
  path.join(__dirname, 'autoreload-bg.js'),
  'utf8',
);

export default (new Runtime({
  loadConfig({config}) {
    config.invalidateOnBuild();
  },
  async apply({bundle, bundleGraph, options}) {
    if (!bundle.env.isBrowser() || bundle.env.isWorklet()) {
      return;
    }

    if (bundle.getMainEntry()?.meta.webextEntry === true) {
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
      if (!manifest || !entry || insertDep == null) return;
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
        return [
          {
            filePath: __filename,
            code: AUTORELOAD_BG,
            isEntry: true,
          },
          {
            filePath: __filename,
            // cache bust on non-asset manifest.json changes
            code: `JSON.parse(${JSON.stringify(
              JSON.stringify(
                JSON.parse(
                  replaceURLReferences({
                    bundle: manifest,
                    bundleGraph,
                    contents: await entry.getCode(),
                    getReplacement: () => '',
                  }).contents,
                ),
              ),
            )})`,
            isEntry: true,
          },
        ];
      }
    }
  },
}): Runtime);
