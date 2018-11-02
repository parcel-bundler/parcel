// @flow
'use strict';

import {packager} from '@parcel/plugin';

export default packager({
  async package(bundle) {
    return bundle.assets.map(asset => asset.output.code).join('\n\n');
  }
});
