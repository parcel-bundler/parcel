import {bundle, run, outputFS} from '@parcel/test-utils';
import assert from 'assert';
import path from 'path';

describe('config merging', function () {
  it('should merge incomplete config packages', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/config-merging/index.js'),
    );
    let content = (
      await outputFS.readFile(
        path.join(__dirname, '/integration/config-merging/dist/index.js'),
      )
    ).toString();
    assert(content.includes('runtime injected'));
    assert.equal((await run(b)).default, 'Hello world!');
  });
});
