// @flow strict-local

import {Packager} from '@parcel/plugin';

export default new Packager({
  async package(bundle) {
    let promises = [];
    bundle.traverseAssets(asset => {
      promises.push(asset.getCode());
    });
    let outputs = await Promise.all(promises);

    return {code: await outputs.map(output => output).join('\n')};
  }
});
