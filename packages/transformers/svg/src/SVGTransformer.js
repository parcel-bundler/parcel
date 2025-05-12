// @flow

import {Transformer} from '@parcel/plugin';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {
  transformSvg,
  envToRust,
  dependencyFromRust,
  assetFromRust,
} from '@parcel/rust';

export default (new Transformer({
  async transform({asset}) {
    asset.bundleBehavior = 'isolated';

    let res = transformSvg({
      code: await asset.getBuffer(),
      filePath: asset.filePath,
      xml: true,
      env: envToRust(asset.env),
      hmr: false,
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
