// @flow
import ParcelConfig from '../src/ParcelConfig';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';
import logger from '@parcel/logger';
import {inputFS} from '@parcel/test-utils';
import {NodePackageManager} from '@parcel/package-manager';

const packageManager = new NodePackageManager(inputFS);

describe('ParcelConfig', () => {
  describe('matchGlobMap', () => {
    let config = new ParcelConfig(
      {
        filePath: '.parcelrc',
        bundler: undefined,
        packagers: {
          '*.css': {
            packageName: 'parcel-packager-css',
            resolveFrom: '.parcelrc',
          },
          '*.js': {
            packageName: 'parcel-packager-js',
            resolveFrom: '.parcelrc',
          },
        },
      },
      packageManager,
      false,
    );

    it('should return null array if no glob matches', () => {
      let result = config.matchGlobMap('foo.wasm', config.packagers);
      assert.deepEqual(result, null);
    });

    it('should return a matching pipeline', () => {
      let result = config.matchGlobMap('foo.js', config.packagers);
      assert.deepEqual(result, {
        packageName: 'parcel-packager-js',
        resolveFrom: '.parcelrc',
      });
    });
  });

  describe('matchGlobMapPipelines', () => {
    let config = new ParcelConfig(
      {
        filePath: '.parcelrc',
        bundler: undefined,
        transformers: {
          '*.jsx': [
            {
              packageName: 'parcel-transform-jsx',
              resolveFrom: '.parcelrc',
            },
            '...',
          ],
          '*.{js,jsx}': [
            {
              packageName: 'parcel-transform-js',
              resolveFrom: '.parcelrc',
            },
          ],
        },
      },
      packageManager,
      false,
    );

    it('should return an empty array if no pipeline matches', () => {
      let pipeline = config.matchGlobMapPipelines(
        'foo.css',
        config.transformers,
      );
      assert.deepEqual(pipeline, []);
    });

    it('should return a matching pipeline', () => {
      let pipeline = config.matchGlobMapPipelines(
        'foo.js',
        config.transformers,
      );
      assert.deepEqual(pipeline, [
        {
          packageName: 'parcel-transform-js',
          resolveFrom: '.parcelrc',
        },
      ]);
    });

    it('should merge pipelines with spread elements', () => {
      let pipeline = config.matchGlobMapPipelines(
        'foo.jsx',
        config.transformers,
      );
      assert.deepEqual(pipeline, [
        {
          packageName: 'parcel-transform-jsx',
          resolveFrom: '.parcelrc',
        },
        {
          packageName: 'parcel-transform-js',
          resolveFrom: '.parcelrc',
        },
      ]);
    });
  });

  describe('loadPlugin', () => {
    it('should warn if a plugin needs to specify an engines.parcel field in package.json', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'plugins',
        '.parcelrc',
      );
      let config = new ParcelConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: 'parcel-transformer-no-engines',
                resolveFrom: configFilePath,
              },
            ],
          },
        },
        packageManager,
        false,
      );

      sinon.stub(logger, 'warn');
      let {plugin} = await config.loadPlugin({
        packageName: 'parcel-transformer-no-engines',
        resolveFrom: configFilePath,
      });
      assert(plugin);
      assert.equal(typeof plugin.transform, 'function');
      assert(logger.warn.calledOnce);
      assert.deepEqual(logger.warn.getCall(0).args[0], {
        origin: '@parcel/core',
        message:
          'The plugin "parcel-transformer-no-engines" needs to specify a `package.json#engines.parcel` field with the supported Parcel version range.',
      });
      logger.warn.restore();
    });

    it('should error if a plugin specifies an invalid engines.parcel field in package.json', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'plugins',
        '.parcelrc',
      );
      let config = new ParcelConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: 'parcel-transformer-bad-engines',
                resolveFrom: configFilePath,
              },
            ],
          },
        },
        packageManager,
        false,
      );

      let errored = false;
      try {
        await config.loadPlugin({
          packageName: 'parcel-transformer-bad-engines',
          resolveFrom: configFilePath,
        });
      } catch (err) {
        errored = true;
        let parcelVersion = require('../package.json').version;
        assert.equal(
          err.message,
          `The plugin "parcel-transformer-bad-engines" is not compatible with the current version of Parcel. Requires "5.x" but the current version is "${parcelVersion}".`,
        );
      }

      assert(errored, 'did not error');
    });
  });
});
