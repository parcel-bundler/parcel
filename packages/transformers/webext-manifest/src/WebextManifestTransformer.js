// @flow
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json
// https://developer.chrome.com/extensions/manifest

import {Transformer} from '@parcel/plugin';

// TODO
export default new Transformer({
  async transform({asset}) {
    if (asset.env.context === 'pwa-manifest') {
      asset.type = 'webmanifest';
    }
    return [asset];
  }
});
