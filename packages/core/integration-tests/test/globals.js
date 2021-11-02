import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';

describe('global alias', function () {
  it('should support global alias syntax', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/global-alias/index.js'),
    );

    assert.equal(
      await run(b, {
        React: {
          createElement: function () {
            return 'ok';
          },
        },
      }),
      'ok',
    );
  });
});
