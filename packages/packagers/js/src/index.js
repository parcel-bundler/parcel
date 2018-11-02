// @flow
'use strict';

import {Packager} from '@parcel/plugin';

export default new Packager({
  async package(bundle) {
    return bundle.assets.map(asset => asset.output.code).join('\n\n');
  }
});
