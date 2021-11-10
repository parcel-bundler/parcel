import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import {DevPackager} from '../../../packagers/js/src/DevPackager';
import {ScopeHoistingPackager} from '../../../packagers/js/src/ScopeHoistingPackager';
import PluginOptions from '@parcel/core/src/public/PluginOptions';
import resolveOptions from '@parcel/core/src/resolveOptions';

describe('global-var', function () {
  describe('bundle', function () {
    it('should pass the global var', async function () {
      const b = await bundle(
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
      const output = await packager.package();
      assert.equal(
        output.contents.substr(output.contents.length - 32),
        '"aRequiredName", "hello-world")\n',
      );
    });

    it('should contain empty string if no global var is passed', async function () {
      const b = await bundle(
        path.join(__dirname, '/integration/global-var/index.js'),
      );
      const packager = new DevPackager(
        {
          projectRoot: '',
          global: '',
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
      const output = await packager.package();
      assert.equal(output.contents.substr(output.contents.length - 3), '();');
    });
  });

  describe('plugin options', function () {
    it('should contain the global value', function () {
      const pluginOptions = new PluginOptions({
        global: 'hello-world',
      });
      assert.equal(pluginOptions.global, 'hello-world');
    });
  });

  describe('resolve options', function () {
    it('resolveOptions should resolve global value', async function () {
      const result = await resolveOptions({
        global: 'hello-world',
      });
      assert.equal(result.global, 'hello-world');
    });
  });
});
