// @flow

import {Transformer} from '@parcel/plugin';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {
  transformHtml,
  envToRust,
  dependencyFromRust,
  assetFromRust,
} from '@parcel/rust';

export default (new Transformer({
  async transform({asset, options}) {
    if (asset.type === 'htm') {
      asset.type = 'html';
    }

    asset.bundleBehavior = 'isolated';

    let res = transformHtml({
      code: await asset.getBuffer(),
      filePath: asset.filePath,
      xml: asset.type === 'xhtml',
      env: envToRust(asset.env),
      hmr: !!options.hmrOptions,
    });

    if (res.errors.length) {
      throw new ThrowableDiagnostic({
        diagnostic: res.errors,
      });
    }

    asset.setBuffer(res.code);

    let assets = [asset];
    for (let dep of res.dependencies) {
      asset.addDependency(dependencyFromRust(dep));
    }

    for (let a of res.assets) {
      assets.push(assetFromRust(a));
    }

    return assets;
  },
}): Transformer);
