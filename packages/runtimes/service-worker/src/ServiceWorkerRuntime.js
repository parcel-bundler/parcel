// @flow strict-local

import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';

export default new Runtime({
  apply({bundle, bundleGraph, options}) {
    if (bundle.env.context !== 'service-worker') {
      return;
    }

    let code = `
      import {createServiceWorker} from './service-worker';
      createServiceWorker("${urlJoin(
        bundle.target.publicUrl ?? '/',
        'parcel-manifest.json'
      )}");
    `;

    return [
      {
        filePath: __filename,
        code,
        isEntry: true
      }
    ];
  }
});
