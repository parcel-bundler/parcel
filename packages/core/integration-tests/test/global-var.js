import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import {DevPackager} from '../../../packagers/js/src/DevPackager';

describe('global-var', function() {
  it('should product a global var', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-var/index.js'),
    );
    const packager = new DevPackager(
      {
        projectRoot: '',
        globalVar: 'hello-world',
      },
      b,
      b.getBundles()[0],
      'aRequiredName',
    );
    let output = await packager.package();
    assert.equal(
      output.contents.includes(
        '},{}]},["ePXF2"], "ePXF2", "aRequiredName", "hello-world")',
      ),
      true,
    );
  });
});
