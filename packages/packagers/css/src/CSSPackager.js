// @flow strict-local

import {Packager} from '@parcel/plugin';

export default new Packager({
  async package(bundle) {
    let promises = [];
    bundle.traverseAssets(asset => {
      promises.push(asset.getOutput());
    });
    let outputs = await Promise.all(promises);

    return outputs.map(output => output.code).join('\n');
  }
});
