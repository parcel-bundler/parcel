// @flow strict-local

import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';

describe('BundleGraph', () => {
  it('can traverse assets across bundles and contexts', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
    );

    let assets = [];
    b.traverse(node => {
      if (node.type === 'asset') {
        assets.push({
          type: node.type,
          value: path.basename(
            node.value.filePath.replace(/runtime-[0-9a-f]*/g, 'runtime'),
          ),
        });
      }
    });

    assert.deepEqual(assets, [
      {
        type: 'asset',
        value: 'index.js',
      },
      {
        type: 'asset',
        value: 'lodash.js',
      },
      {
        type: 'asset',
        value: 'worker-a.js',
      },
      {
        type: 'asset',
        value: 'lodash.js',
      },
      {
        type: 'asset',
        value: 'worker-b.js',
      },
      {
        type: 'asset',
        value: 'esmodule-helpers.js',
      },
      {
        type: 'asset',
        value: 'runtime.js',
      },
      {
        type: 'asset',
        value: 'get-worker-url.js',
      },
      {
        type: 'asset',
        value: 'bundle-url.js',
      },
      {
        type: 'asset',
        value: 'runtime.js',
      },
      {
        type: 'asset',
        value: 'get-worker-url.js',
      },
      {
        type: 'asset',
        value: 'bundle-url.js',
      },
      {
        type: 'asset',
        value: 'esmodule-helpers.js',
      },
    ]);
  });
});
