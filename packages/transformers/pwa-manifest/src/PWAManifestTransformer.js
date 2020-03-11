// @flow
// https://developer.mozilla.org/en-US/docs/Web/Manifest

import type {MutableAsset} from '@parcel/types';
import {Transformer} from '@parcel/plugin';
import invariant from 'assert';

type Manifest = {
  serviceworker?: string,
  icons: Array<{src: string, ...}>,
  screenshots: Array<{src: string, ...}>,
  ...
};

function collectDependencies(asset: MutableAsset, manifest: Manifest) {
  for (let key of ['icons', 'screenshots']) {
    let list = manifest[key];
    if (list) {
      invariant(Array.isArray(list));
      for (let icon of list) {
        invariant(
          icon && typeof icon === 'object' && typeof icon.src === 'string',
        );
        icon.src = asset.addURLDependency(icon.src, {}); // TODO loc
      }
    }
  }
  if (manifest.serviceworker) {
    manifest.serviceworker = asset.addURLDependency(manifest.serviceworker, {
      isEntry: true,
      env: {context: 'service-worker'},
    });
  }
}
export default new Transformer({
  async transform({asset}) {
    const json: Manifest = JSON.parse(await asset.getCode());
    collectDependencies(asset, json);
    asset.setCode(JSON.stringify(json));
    return [asset];
  },
});
