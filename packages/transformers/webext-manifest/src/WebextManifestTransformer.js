// @flow
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async transform({asset}) {
    if (asset.env.context === 'pwa-manifest') {
      asset.type = 'webmanifest';
    }
    return [asset];
  }
});
