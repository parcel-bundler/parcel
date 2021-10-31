import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import {DevPackager} from '../../../packagers/js/src/DevPackager';
import {ScopeHoistingPackager} from '../../../packagers/js/src/ScopeHoistingPackager';

describe('global-var', function() {
  it('should pass the global var', async function() {
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
      output.contents.substr(output.contents.length - 32),
      '"aRequiredName", "hello-world")\n',
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
    const result = requireFromString(output.contents);
    assert.equal(result.default.mount(), 'Hello World');
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
    const result = eval(
      output.contents.replace(
        'module.exports = mainExports',
        'return {[globalName]:mainExports}',
      ),
    );
    assert.equal(result['hello-world'].default.mount(), 'Hello World');
  });

  it('when hoisted should not use globalName', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-var/index.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );
    const packager = new ScopeHoistingPackager(
      {
        projectRoot: '',
        global: 'hello-world',
      },
      b,
      b.getBundles()[0],
      'aRequiredName',
    );
    let output = await packager.package();
    assert.equal(output.contents.substr(output.contents.length - 3), '();');
  });
});
