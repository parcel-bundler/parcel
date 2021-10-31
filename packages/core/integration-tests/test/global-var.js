import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import {DevPackager} from '../../../packagers/js/src/DevPackager';

describe('global-var', function() {
  it('should contain the global var', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-var/index.js'),
    );
    const packager = new DevPackager(
      {
        projectRoot: '',
        global: 'hello-world',
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

  it('should mount as commonjs', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-var/index.js'),
    );
    const packager = new DevPackager(
      {
        projectRoot: '',
        global: 'hello-world',
      },
      b,
      b.getBundles()[0],
      'aRequiredName',
    );
    let output = await packager.package();
    function requireFromString(src) {
      var Module = module.constructor;
      var m = new Module();
      m._compile(src, '');
      return m.exports;
    }
    const helloWorld = requireFromString(output.contents);
    assert.equal(helloWorld.default.mount(), 'Hello World');
  });

  it('should have the globalName', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-var/index.js'),
    );
    const packager = new DevPackager(
      {
        projectRoot: '',
        global: 'hello-world',
      },
      b,
      b.getBundles()[0],
      'aRequiredName',
    );
    let output = await packager.package();
    const helloWorldModule = eval(
      output.contents.replace(
        'module.exports = mainExports',
        'return {[globalName]:mainExports}',
      ),
    );
    assert.equal(
      helloWorldModule['hello-world'].default.mount(),
      'Hello World',
    );
  });
});
