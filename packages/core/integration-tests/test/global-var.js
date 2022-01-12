import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import {DevPackager} from '../../../packagers/js/src/DevPackager';
import {ScopeHoistingPackager} from '../../../packagers/js/src/ScopeHoistingPackager';
import resolveOptions from '@parcel/core/src/resolveOptions';

describe('global-var', function () {
  describe('bundle', function () {
    it('should pass the global var', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
        {
          defaultTargetOptions: {
            global: 'hello-world',
          },
        },
      );
      const packager = new DevPackager(
        {
          projectRoot: '',
        },
        b,
        b.getBundles()[0],
        'aRequiredName',
      );
      const output = await packager.package();
      assert.equal(
        output.contents.substr(output.contents.length - 32),
        '"aRequiredName", "hello-world")\n',
      );
    });

    it('should not pass the global var when outputFormat is not global', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
        {
          defaultTargetOptions: {
            global: 'hello-world',
            outputFormat: 'esmodule',
          },
        },
      );
      const packager = new DevPackager(
        {
          projectRoot: '',
        },
        b,
        b.getBundles()[0],
        'aRequiredName',
      );
      const output = await packager.package();
      assert.equal(output.contents.includes('"aRequiredName", "")\n'), true);
    });

    it('should contain empty string if no global var is passed', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
        {
          defaultTargetOptions: {
            global: '',
          },
        },
      );
      const packager = new DevPackager(
        {
          projectRoot: '',
        },
        b,
        b.getBundles()[0],
        'aRequiredName',
      );
      const output = await packager.package();
      assert.equal(output.contents.includes('"aRequiredName", "")\n'), true);
    });

    it('should mount as commonjs', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
        {
          defaultTargetOptions: {
            global: 'hello-world',
          },
        },
      );
      const packager = new DevPackager(
        {
          projectRoot: '',
        },
        b,
        b.getBundles()[0],
        'aRequiredName',
      );
      const output = await packager.package();
      function requireFromString(src) {
        var Module = module.constructor;
        var m = new Module();
        m._compile(src, '');
        return m.exports;
      }
      const result = requireFromString(output.contents);
      assert.equal(result.default.mount(), 'Hello World');
    });

    it('should have the globalName', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
        {
          defaultTargetOptions: {
            global: 'hello-world',
          },
        },
      );
      const packager = new DevPackager(
        {
          projectRoot: '',
        },
        b,
        b.getBundles()[0],
        'aRequiredName',
      );
      const output = await packager.package();
      const result = eval(
        output.contents.replace(
          'module.exports = mainExports',
          'return {[globalName]:mainExports}',
        ),
      );
      assert.equal(result['hello-world'].default.mount(), 'Hello World');
    });

    it('should not use globalName when hoisted', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
        {
          defaultTargetOptions: {
            shouldScopeHoist: true,
            global: 'hello-world',
          },
        },
      );
      const packager = new ScopeHoistingPackager(
        {
          projectRoot: '',
        },
        b,
        b.getBundles()[0],
        'aRequiredName',
      );
      const output = await packager.package();
      assert.equal(output.contents.substr(output.contents.length - 3), '();');
    });
  });

  describe('resolve options', function () {
    it('resolveOptions should resolve global value', async function () {
      const result = await resolveOptions({
        defaultTargetOptions: {
          global: 'hello-world',
        },
      });
      assert.equal(result.defaultTargetOptions.global, 'hello-world');
    });
  });
});
