import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';

describe('global-var', function() {
  it('should product a global var', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-var/index.js'),
    );
    let output = (await run(b)).default;
    assert.equal(output.name, 'Test Module');
    assert.equal(output.mount(), 'Hello World');
  });
});
