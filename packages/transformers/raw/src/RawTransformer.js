// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    asset.bundleBehavior = 'isolated';
    // Fake symbol to prevent "does not export default" error in symbol propagation.
    asset.symbols.ensure();
    asset.symbols.set('*', 'url');
    return [asset];
  },
}): Transformer);
