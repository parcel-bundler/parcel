// @flow
import assert from 'assert';
import path from 'path';
import ParcelConfig from '../src/ParcelConfig';
import {
  validateConfigFile,
  mergePipelines,
  mergeMaps,
  mergeConfigs,
  resolveExtends,
  readAndProcessConfigChain,
  resolveParcelConfig,
  processConfig,
} from '../src/loadParcelConfig';
import {validatePackageName} from '../src/ParcelConfig.schema';
import {DEFAULT_OPTIONS} from './utils';

describe('loadParcelConfig', () => {
  describe('validatePackageName', () => {
    it('should error on an invalid official package', () => {
      assert.throws(() => {
        validatePackageName('@parcel/foo-bar', 'transform', 'transformers');
      }, /Official parcel transform packages must be named according to "@parcel\/transform-{name}"/);

      assert.throws(() => {
        validatePackageName('@parcel/transformer', 'transform', 'transformers');
      }, /Official parcel transform packages must be named according to "@parcel\/transform-{name}"/);
    });

    it('should succeed on a valid official package', () => {
      validatePackageName('@parcel/transform-bar', 'transform', 'transformers');
    });

    it('should error on an invalid community package', () => {
      assert.throws(() => {
        validatePackageName('foo-bar', 'transform', 'transformers');
      }, /Parcel transform packages must be named according to "parcel-transform-{name}"/);

      assert.throws(() => {
        validatePackageName('parcel-foo-bar', 'transform', 'transformers');
      }, /Parcel transform packages must be named according to "parcel-transform-{name}"/);

      assert.throws(() => {
        validatePackageName('parcel-transform', 'transform', 'transformers');
      }, /Parcel transform packages must be named according to "parcel-transform-{name}"/);
    });

    it('should succeed on a valid community package', () => {
      validatePackageName('parcel-transform-bar', 'transform', 'transformers');
    });

    it('should error on an invalid scoped package', () => {
      assert.throws(() => {
        validatePackageName('@test/foo-bar', 'transform', 'transformers');
      }, /Scoped parcel transform packages must be named according to "@test\/parcel-transform\[-{name}\]"/);

      assert.throws(() => {
        validatePackageName(
          '@test/parcel-foo-bar',
          'transform',
          'transformers',
        );
      }, /Scoped parcel transform packages must be named according to "@test\/parcel-transform\[-{name}\]"/);
    });

    it('should succeed on a valid scoped package', () => {
      validatePackageName(
        '@test/parcel-transform-bar',
        'transform',
        'transformers',
      );

      validatePackageName(
        '@test/parcel-transform',
        'transform',
        'transformers',
      );
    });
  });

  describe('validateConfigFile', () => {
    it('should throw on invalid config', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            extends: 'parcel-config-foo',
            transformers: {
              '*.js': ['parcel-invalid-plugin'],
            },
          },
          '.parcelrc',
        );
      });
    });

    it('should require pipeline to be an array', () => {
      assert.throws(() => {
        validateConfigFile(
          // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
          {
            filePath: '.parcelrc',
            resolvers: '123',
          },
          '.parcelrc',
        );
      });
    });

    it('should require pipeline elements to be strings', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            // $FlowFixMe
            resolvers: [1, '123', 5],
          },
          '.parcelrc',
        );
      });
    });

    it('should require package names to be valid', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            resolvers: ['parcel-foo-bar'],
          },
          '.parcelrc',
        );
      });
    });

    it('should succeed with an array of valid package names', () => {
      validateConfigFile(
        {
          filePath: '.parcelrc',
          resolvers: ['parcel-resolver-test'],
        },
        '.parcelrc',
      );
    });

    it('should support spread elements', () => {
      validateConfigFile(
        {
          filePath: '.parcelrc',
          resolvers: ['parcel-resolver-test', '...'],
        },
        '.parcelrc',
      );
    });

    it('should require glob map to be an object', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            // $FlowFixMe
            transformers: ['parcel-transformer-test', '...'],
          },
          '.parcelrc',
        );
      });
    });

    it('should trigger the validator function for each key', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            transformers: {
              'types:*.{ts,tsx}': ['@parcel/transformer-typescript-types'],
              'bundle-text:*': ['-inline-string', '...'],
            },
          },
          '.parcelrc',
        );
      });
    });

    it('should require extends to be a string or array of strings', () => {
      assert.throws(() => {
        validateConfigFile(
          // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
          {
            filePath: '.parcelrc',
            extends: 2,
          },
          '.parcelrc',
        );
      });

      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            // $FlowFixMe
            extends: [2, 7],
          },
          '.parcelrc',
        );
      });
    });

    it('should support relative paths', () => {
      validateConfigFile(
        {
          filePath: '.parcelrc',
          extends: './foo',
        },
        '.parcelrc',
      );

      validateConfigFile(
        {
          filePath: '.parcelrc',
          extends: ['./foo', './bar'],
        },
        '.parcelrc',
      );
    });

    it('should validate package names', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            extends: 'foo',
          },
          '.parcelrc',
        );
      });

      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.parcelrc',
            extends: ['foo', 'bar'],
          },
          '.parcelrc',
        );
      });

      validateConfigFile(
        {
          filePath: '.parcelrc',
          extends: 'parcel-config-foo',
        },
        '.parcelrc',
      );

      validateConfigFile(
        {
          filePath: '.parcelrc',
          extends: ['parcel-config-foo', 'parcel-config-bar'],
        },
        '.parcelrc',
      );
    });

    it('should succeed on valid config', () => {
      validateConfigFile(
        {
          filePath: '.parcelrc',
          extends: 'parcel-config-foo',
          transformers: {
            '*.js': ['parcel-transformer-foo'],
          },
        },
        '.parcelrc',
      );
    });

    it('should throw error on empty config file', () => {
      assert.throws(() => {
        validateConfigFile({}, '.parcelrc');
      }, /.parcelrc can't be empty/);
    });
  });

  describe('mergePipelines', () => {
    it('should return an empty array if base and extension are null', () => {
      assert.deepEqual(mergePipelines(null, null), []);
    });

    it('should return base if extension is null', () => {
      assert.deepEqual(
        mergePipelines(
          [
            {
              packageName: 'parcel-transform-foo',
              resolveFrom: '.parcelrc',
            },
          ],
          null,
        ),
        [
          {
            packageName: 'parcel-transform-foo',
            resolveFrom: '.parcelrc',
          },
        ],
      );
    });

    it('should return extension if base is null', () => {
      assert.deepEqual(
        mergePipelines(null, [
          {
            packageName: 'parcel-transform-bar',
            resolveFrom: '.parcelrc',
          },
        ]),
        [
          {
            packageName: 'parcel-transform-bar',
            resolveFrom: '.parcelrc',
          },
        ],
      );
    });

    it('should return extension if there are no spread elements', () => {
      assert.deepEqual(
        mergePipelines(
          [
            {
              packageName: 'parcel-transform-foo',
              resolveFrom: '.parcelrc',
            },
          ],
          [
            {
              packageName: 'parcel-transform-bar',
              resolveFrom: '.parcelrc',
            },
          ],
        ),
        [
          {
            packageName: 'parcel-transform-bar',
            resolveFrom: '.parcelrc',
          },
        ],
      );
    });

    it('should return merge base into extension if there are spread elements', () => {
      assert.deepEqual(
        mergePipelines(
          [
            {
              packageName: 'parcel-transform-foo',
              resolveFrom: '.parcelrc',
            },
          ],
          [
            {
              packageName: 'parcel-transform-bar',
              resolveFrom: '.parcelrc',
            },
            '...',
            {
              packageName: 'parcel-transform-baz',
              resolveFrom: '.parcelrc',
            },
          ],
        ),
        [
          {
            packageName: 'parcel-transform-bar',
            resolveFrom: '.parcelrc',
          },
          {
            packageName: 'parcel-transform-foo',
            resolveFrom: '.parcelrc',
          },
          {
            packageName: 'parcel-transform-baz',
            resolveFrom: '.parcelrc',
          },
        ],
      );
    });

    it('should throw if more than one spread element is in a pipeline', () => {
      assert.throws(() => {
        mergePipelines(
          [
            {
              packageName: 'parcel-transform-foo',
              resolveFrom: '.parcelrc',
            },
          ],
          [
            {
              packageName: 'parcel-transform-bar',
              resolveFrom: '.parcelrc',
            },
            '...',
            {
              packageName: 'parcel-transform-baz',
              resolveFrom: '.parcelrc',
            },
            '...',
          ],
        );
      }, /Only one spread element can be included in a config pipeline/);
    });
  });

  describe('mergeMaps', () => {
    it('should return an empty object if base and extension are null', () => {
      assert.deepEqual(mergeMaps(null, null), {});
    });

    it('should return base if extension is null', () => {
      assert.deepEqual(mergeMaps({'*.js': 'foo'}, null), {
        '*.js': 'foo',
      });
    });

    it('should return extension if base is null', () => {
      assert.deepEqual(mergeMaps(null, {'*.js': 'foo'}), {
        '*.js': 'foo',
      });
    });

    it('should merge the objects', () => {
      assert.deepEqual(
        mergeMaps({'*.css': 'css', '*.js': 'base-js'}, {'*.js': 'ext-js'}),
        {'*.js': 'ext-js', '*.css': 'css'},
      );
    });

    it('should ensure that extension properties have a higher precidence than base properties', () => {
      assert.deepEqual(
        mergeMaps({'*.{js,jsx}': 'base-js'}, {'*.js': 'ext-js'}),
        {'*.js': 'ext-js', '*.{js,jsx}': 'base-js'},
      );
      assert.deepEqual(
        Object.keys(mergeMaps({'*.{js,jsx}': 'base-js'}, {'*.js': 'ext-js'})),
        ['*.js', '*.{js,jsx}'],
      );
    });

    it('should call a merger function if provided', () => {
      let merger = (a, b) => [a, b];
      assert.deepEqual(
        mergeMaps({'*.js': 'base-js'}, {'*.js': 'ext-js'}, merger),
        {'*.js': ['base-js', 'ext-js']},
      );
    });
  });

  describe('mergeConfigs', () => {
    it('should merge configs', () => {
      let base = new ParcelConfig(
        {
          filePath: '.parcelrc',
          resolvers: [
            {
              packageName: 'parcel-resolver-base',
              resolveFrom: '.parcelrc',
            },
          ],
          transformers: {
            '*.js': [
              {
                packageName: 'parcel-transform-base',
                resolveFrom: '.parcelrc',
              },
            ],
            '*.css': [
              {
                packageName: 'parcel-transform-css',
                resolveFrom: '.parcelrc',
              },
            ],
          },
          bundler: {
            packageName: 'parcel-bundler-base',
            resolveFrom: '.parcelrc',
          },
        },
        DEFAULT_OPTIONS.packageManager,
        false,
      );

      let ext = {
        filePath: '.parcelrc',
        resolvers: [
          {
            packageName: 'parcel-resolver-ext',
            resolveFrom: '.parcelrc',
          },
          '...',
        ],
        transformers: {
          '*.js': [
            {
              packageName: 'parcel-transform-ext',
              resolveFrom: '.parcelrc',
            },
            '...',
          ],
        },
      };

      let merged = new ParcelConfig(
        {
          filePath: '.parcelrc',
          resolvers: [
            {
              packageName: 'parcel-resolver-ext',
              resolveFrom: '.parcelrc',
            },
            {
              packageName: 'parcel-resolver-base',
              resolveFrom: '.parcelrc',
            },
          ],
          transformers: {
            '*.js': [
              {
                packageName: 'parcel-transform-ext',
                resolveFrom: '.parcelrc',
              },
              {
                packageName: 'parcel-transform-base',
                resolveFrom: '.parcelrc',
              },
            ],
            '*.css': [
              {
                packageName: 'parcel-transform-css',
                resolveFrom: '.parcelrc',
              },
            ],
          },
          bundler: {
            packageName: 'parcel-bundler-base',
            resolveFrom: '.parcelrc',
          },
          runtimes: {},
          namers: [],
          optimizers: {},
          packagers: {},
          reporters: [],
        },
        DEFAULT_OPTIONS.packageManager,
        false,
      );

      // $FlowFixMe
      assert.deepEqual(mergeConfigs(base, ext), merged);
    });
  });

  describe('resolveExtends', () => {
    it('should resolve a relative path', async () => {
      let resolved = await resolveExtends(
        '../.parcelrc',
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.parcelrc'),
        DEFAULT_OPTIONS,
      );
      assert.equal(
        resolved,
        path.join(__dirname, 'fixtures', 'config', '.parcelrc'),
      );
    });

    it('should resolve a package name', async () => {
      let resolved = await resolveExtends(
        '@parcel/config-default',
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.parcelrc'),
        DEFAULT_OPTIONS,
      );
      assert.equal(resolved, require.resolve('@parcel/config-default'));
    });
  });

  describe('readAndProcessConfigChain', () => {
    it('should load and merge configs', async () => {
      let defaultConfigPath = require.resolve('@parcel/config-default');
      let defaultConfig = processConfig({
        ...require('@parcel/config-default'),
        filePath: defaultConfigPath,
      });
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config',
        '.parcelrc',
      );
      let subConfigFilePath = path.join(
        __dirname,
        'fixtures',
        'config',
        'subfolder',
        '.parcelrc',
      );
      let {config} = await readAndProcessConfigChain(
        subConfigFilePath,
        DEFAULT_OPTIONS,
      );

      assert.deepEqual(config.transformers['*.js'], [
        {
          packageName: 'parcel-transformer-sub',
          resolveFrom: subConfigFilePath,
        },
        {
          packageName: 'parcel-transformer-base',
          resolveFrom: configFilePath,
        },
        '...',
      ]);
      assert(Object.keys(config.transformers).length > 1);
      assert.deepEqual(config.resolvers, defaultConfig.resolvers);
      assert.deepEqual(config.bundler, defaultConfig.bundler);
      assert.deepEqual(config.namers, defaultConfig.namers || []);
      assert.deepEqual(config.packagers, defaultConfig.packagers || {});
      assert.deepEqual(config.optimizers, defaultConfig.optimizers || {});
      assert.deepEqual(config.reporters, defaultConfig.reporters || []);
    });

    it('should emit a codeframe when a malformed .parcelrc was found', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-malformed',
        '.parcelrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      let pos = {
        line: 2,
        column: 14,
      };

      // $FlowFixMe
      await assert.rejects(
        () => readAndProcessConfigChain(configFilePath, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: 'Failed to parse .parcelrc',
              origin: '@parcel/core',
              filePath: configFilePath,
              language: 'json5',
              codeFrame: {
                code,
                codeHighlights: [
                  {
                    message: "JSON5: invalid character 'b' at 2:14",
                    start: pos,
                    end: pos,
                  },
                ],
              },
            },
          ],
        },
      );
    });
  });

  describe('resolve', () => {
    it('should return null if there is no .parcelrc file found', async () => {
      let resolved = await resolveParcelConfig(DEFAULT_OPTIONS);
      assert.equal(resolved, null);
    });

    it('should resolve a config if a .parcelrc file is found', async () => {
      let resolved = await resolveParcelConfig({
        ...DEFAULT_OPTIONS,
        projectRoot: path.join(__dirname, 'fixtures', 'config', 'subfolder'),
      });

      assert(resolved !== null);
    });
  });
});
