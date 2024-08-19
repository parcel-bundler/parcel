// @flow
import assert from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import AtlaspackConfig from '../src/AtlaspackConfig';
import {
  validateConfigFile,
  mergePipelines,
  mergeMaps,
  mergeConfigs,
  resolveExtends,
  parseAndProcessConfig,
  resolveAtlaspackConfig,
  processConfig,
} from '../src/requests/AtlaspackConfigRequest';
import {validatePackageName} from '../src/AtlaspackConfig.schema';
import {DEFAULT_OPTIONS, relative} from './test-utils';
import {toProjectPath} from '../src/projectPath';

describe('AtlaspackConfigRequest', () => {
  describe('validatePackageName', () => {
    it('should error on an invalid official package', () => {
      assert.throws(() => {
        validatePackageName('@atlaspack/foo-bar', 'transform', 'transformers');
      }, /Official atlaspack transform packages must be named according to "@atlaspack\/transform-{name}"/);

      assert.throws(() => {
        validatePackageName(
          '@atlaspack/transformer',
          'transform',
          'transformers',
        );
      }, /Official atlaspack transform packages must be named according to "@atlaspack\/transform-{name}"/);
    });

    it('should succeed on a valid official package', () => {
      validatePackageName(
        '@atlaspack/transform-bar',
        'transform',
        'transformers',
      );
    });

    it('should error on an invalid community package', () => {
      assert.throws(() => {
        validatePackageName('foo-bar', 'transform', 'transformers');
      }, /Atlaspack transform packages must be named according to "atlaspack-transform-{name}"/);

      assert.throws(() => {
        validatePackageName('atlaspack-foo-bar', 'transform', 'transformers');
      }, /Atlaspack transform packages must be named according to "atlaspack-transform-{name}"/);

      assert.throws(() => {
        validatePackageName('atlaspack-transform', 'transform', 'transformers');
      }, /Atlaspack transform packages must be named according to "atlaspack-transform-{name}"/);
    });

    it('should succeed on a valid community package', () => {
      validatePackageName(
        'atlaspack-transform-bar',
        'transform',
        'transformers',
      );
    });

    // Skipping this while the migration to atlaspack occurs
    it.skip('should error on an invalid scoped package', () => {
      assert.throws(() => {
        validatePackageName('@test/foo-bar', 'transform', 'transformers');
      }, /Scoped atlaspack transform packages must be named according to "@test\/atlaspack-transform\[-{name}\]"/);

      assert.throws(() => {
        validatePackageName(
          '@test/atlaspack-foo-bar',
          'transform',
          'transformers',
        );
      }, /Scoped atlaspack transform packages must be named according to "@test\/atlaspack-transform\[-{name}\]"/);
    });

    it('should succeed on a valid scoped package', () => {
      validatePackageName(
        '@test/atlaspack-transform-bar',
        'transform',
        'transformers',
      );

      validatePackageName(
        '@test/atlaspack-transform',
        'transform',
        'transformers',
      );
    });

    it('should succeed on a local package', () => {
      validatePackageName(
        './atlaspack-transform-bar',
        'transform',
        'transformers',
      );
      validatePackageName('./bar', 'transform', 'transformers');
    });
  });

  describe('validateConfigFile', () => {
    it('should throw on invalid config', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            extends: 'atlaspack-config-foo',
            transformers: {
              '*.js': ['atlaspack-invalid-plugin'],
            },
          },
          '.atlaspackrc',
        );
      });
    });

    it('should require pipeline to be an array', () => {
      assert.throws(() => {
        validateConfigFile(
          // $FlowExpectedError[incompatible-call]
          {
            filePath: '.atlaspackrc',
            resolvers: '123',
          },
          '.atlaspackrc',
        );
      });
    });

    it('should require pipeline elements to be strings', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            // $FlowExpectedError[incompatible-call]
            resolvers: [1, '123', 5],
          },
          '.atlaspackrc',
        );
      });
    });

    it('should require package names to be valid', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            resolvers: ['atlaspack-foo-bar'],
          },
          '.atlaspackrc',
        );
      });
    });

    it('should succeed with an array of valid package names', () => {
      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          resolvers: ['atlaspack-resolver-test'],
        },
        '.atlaspackrc',
      );
    });

    it('should support spread elements', () => {
      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          resolvers: ['atlaspack-resolver-test', '...'],
        },
        '.atlaspackrc',
      );
    });

    it('should require glob map to be an object', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            // $FlowExpectedError[incompatible-call]
            transformers: ['atlaspack-transformer-test', '...'],
          },
          '.atlaspackrc',
        );
      });
    });

    it('should trigger the validator function for each key', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            transformers: {
              'types:*.{ts,tsx}': ['@atlaspack/transformer-typescript-types'],
              'bundle-text:*': ['-inline-string', '...'],
            },
          },
          '.atlaspackrc',
        );
      });
    });

    it('should require extends to be a string or array of strings', () => {
      assert.throws(() => {
        validateConfigFile(
          // $FlowExpectedError[incompatible-call]
          {
            filePath: '.atlaspackrc',
            extends: 2,
          },
          '.atlaspackrc',
        );
      });

      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            // $FlowExpectedError[incompatible-call]
            extends: [2, 7],
          },
          '.atlaspackrc',
        );
      });
    });

    it('should support relative paths', () => {
      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          extends: './foo',
        },
        '.atlaspackrc',
      );

      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          extends: ['./foo', './bar'],
        },
        '.atlaspackrc',
      );
    });

    it('should validate package names', () => {
      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            extends: 'foo',
          },
          '.atlaspackrc',
        );
      });

      assert.throws(() => {
        validateConfigFile(
          {
            filePath: '.atlaspackrc',
            extends: ['foo', 'bar'],
          },
          '.atlaspackrc',
        );
      });

      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          extends: 'atlaspack-config-foo',
        },
        '.atlaspackrc',
      );

      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          extends: ['atlaspack-config-foo', 'atlaspack-config-bar'],
        },
        '.atlaspackrc',
      );
    });

    it('should throw for invalid top level keys', () => {
      assert.throws(
        () => {
          validateConfigFile(
            // $FlowExpectedError
            {
              extends: '@atlaspack/config-default',
              '@atlaspack/transformer-js': {
                inlineEnvironment: false,
              },
            },
            '.atlaspackrc',
          );
        },
        e => {
          assert.strictEqual(
            e.diagnostics[0].codeFrames[0].codeHighlights[0].message,
            `Possible values: "$schema", "bundler", "resolvers", "transformers", "validators", "namers", "packagers", "optimizers", "compressors", "reporters", "runtimes", "filePath", "resolveFrom"`,
          );
          return true;
        },
      );
    });

    it('should succeed on valid config', () => {
      validateConfigFile(
        {
          filePath: '.atlaspackrc',
          extends: 'atlaspack-config-foo',
          transformers: {
            '*.js': ['atlaspack-transformer-foo'],
          },
        },
        '.atlaspackrc',
      );
    });

    it('should throw error on empty config file', () => {
      assert.throws(
        () => {
          validateConfigFile({}, '.atlaspackrc');
        },
        {name: 'Error', message: ".atlaspackrc can't be empty"},
      );
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
              packageName: 'atlaspack-transform-foo',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
          ],
          null,
        ),
        [
          {
            packageName: 'atlaspack-transform-foo',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/0',
          },
        ],
      );
    });

    it('should return extension if base is null', () => {
      assert.deepEqual(
        mergePipelines(null, [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: toProjectPath('/', '/.atlaspackrc'),
            keyPath: '/transformers/*.js/0',
          },
        ]),
        [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/0',
          },
        ],
      );
    });

    it('should return extension if there are no spread elements', () => {
      assert.deepEqual(
        mergePipelines(
          [
            {
              packageName: 'atlaspack-transform-foo',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
          ],
          [
            {
              packageName: 'atlaspack-transform-bar',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
          ],
        ),
        [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/0',
          },
        ],
      );
    });

    it('should return merge base into extension if there are spread elements', () => {
      assert.deepEqual(
        mergePipelines(
          [
            {
              packageName: 'atlaspack-transform-foo',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
          ],
          [
            {
              packageName: 'atlaspack-transform-bar',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
            '...',
            {
              packageName: 'atlaspack-transform-baz',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/2',
            },
          ],
        ),
        [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/0',
          },
          {
            packageName: 'atlaspack-transform-foo',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/0',
          },
          {
            packageName: 'atlaspack-transform-baz',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/2',
          },
        ],
      );
    });

    it('should throw if more than one spread element is in a pipeline', () => {
      assert.throws(() => {
        mergePipelines(
          [
            {
              packageName: 'atlaspack-transform-foo',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
          ],
          [
            {
              packageName: 'atlaspack-transform-bar',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/0',
            },
            '...',
            {
              packageName: 'atlaspack-transform-baz',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/transformers/*.js/2',
            },
            '...',
          ],
        );
      }, /Only one spread element can be included in a config pipeline/);
    });

    it('should remove spread element even without a base map', () => {
      assert.deepEqual(
        mergePipelines(null, [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: toProjectPath('/', '/.atlaspackrc'),
            keyPath: '/transformers/*.js/0',
          },
          '...',
          {
            packageName: 'atlaspack-transform-baz',
            resolveFrom: toProjectPath('/', '/.atlaspackrc'),
            keyPath: '/transformers/*.js/2',
          },
        ]),
        [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/0',
          },
          {
            packageName: 'atlaspack-transform-baz',
            resolveFrom: '.atlaspackrc',
            keyPath: '/transformers/*.js/2',
          },
        ],
      );
    });

    it('should throw if more than one spread element is in a pipeline even without a base map', () => {
      assert.throws(() => {
        mergePipelines(null, [
          {
            packageName: 'atlaspack-transform-bar',
            resolveFrom: toProjectPath('/', '/.atlaspackrc'),
            keyPath: '/transformers/*.js/0',
          },
          '...',
          {
            packageName: 'atlaspack-transform-baz',
            resolveFrom: toProjectPath('/', '/.atlaspackrc'),
            keyPath: '/transformers/*.js/2',
          },
          '...',
        ]);
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

    it('should ensure that extension properties have a higher precedence than base properties', () => {
      let merged = mergeMaps({'*.{js,jsx}': 'base-js'}, {'*.js': 'ext-js'});
      assert.deepEqual(merged, {'*.js': 'ext-js', '*.{js,jsx}': 'base-js'});
      assert.deepEqual(Object.keys(merged), ['*.js', '*.{js,jsx}']);
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
      let base = new AtlaspackConfig(
        {
          filePath: toProjectPath('/', '/.atlaspackrc'),
          resolvers: [
            {
              packageName: 'atlaspack-resolver-base',
              resolveFrom: toProjectPath('/', '/.atlaspackrc'),
              keyPath: '/resolvers/0',
            },
          ],
          transformers: {
            '*.js': [
              {
                packageName: 'atlaspack-transform-base',
                resolveFrom: toProjectPath('/', '/.atlaspackrc'),
                keyPath: '/transformers/*.js/0',
              },
            ],
            '*.css': [
              {
                packageName: 'atlaspack-transform-css',
                resolveFrom: toProjectPath('/', '/.atlaspackrc'),
                keyPath: '/transformers/*.css/0',
              },
            ],
          },
          bundler: {
            packageName: 'atlaspack-bundler-base',
            resolveFrom: toProjectPath('/', '/.atlaspackrc'),
            keyPath: '/bundler',
          },
        },
        DEFAULT_OPTIONS,
      );

      let ext = {
        filePath: '.atlaspackrc',
        resolvers: [
          {
            packageName: 'atlaspack-resolver-ext',
            resolveFrom: '.atlaspackrc',
            keyPath: '/resolvers/0',
          },
          '...',
        ],
        transformers: {
          '*.js': [
            {
              packageName: 'atlaspack-transform-ext',
              resolveFrom: '.atlaspackrc',
              keyPath: '/transformers/*.js/0',
            },
            '...',
          ],
        },
      };

      let merged = {
        filePath: '.atlaspackrc',
        resolvers: [
          {
            packageName: 'atlaspack-resolver-ext',
            resolveFrom: '.atlaspackrc',
            keyPath: '/resolvers/0',
          },
          {
            packageName: 'atlaspack-resolver-base',
            resolveFrom: '.atlaspackrc',
            keyPath: '/resolvers/0',
          },
        ],
        transformers: {
          '*.js': [
            {
              packageName: 'atlaspack-transform-ext',
              resolveFrom: '.atlaspackrc',
              keyPath: '/transformers/*.js/0',
            },
            {
              packageName: 'atlaspack-transform-base',
              resolveFrom: '.atlaspackrc',
              keyPath: '/transformers/*.js/0',
            },
          ],
          '*.css': [
            {
              packageName: 'atlaspack-transform-css',
              resolveFrom: '.atlaspackrc',
              keyPath: '/transformers/*.css/0',
            },
          ],
        },
        bundler: {
          packageName: 'atlaspack-bundler-base',
          resolveFrom: '.atlaspackrc',
          keyPath: '/bundler',
        },
        runtimes: [],
        namers: [],
        optimizers: {},
        compressors: {},
        packagers: {},
        reporters: [],
        validators: {},
      };

      // $FlowFixMe
      assert.deepEqual(mergeConfigs(base, ext), merged);
    });
  });

  describe('resolveExtends', () => {
    it('should resolve a relative path', async () => {
      let resolved = await resolveExtends(
        '../.atlaspackrc',
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.atlaspackrc'),
        '/extends',
        DEFAULT_OPTIONS,
      );
      assert.equal(
        resolved,
        path.join(__dirname, 'fixtures', 'config', '.atlaspackrc'),
      );
    });

    it('should resolve a package name', async () => {
      let resolved = await resolveExtends(
        '@atlaspack/config-default',
        path.join(__dirname, 'fixtures', 'config', 'subfolder', '.atlaspackrc'),
        '/extends',
        DEFAULT_OPTIONS,
      );
      assert.equal(resolved, require.resolve('@atlaspack/config-default'));
    });
  });

  describe('parseAndProcessConfig', () => {
    it('should load and merge configs', async () => {
      let defaultConfigPath = require.resolve('@atlaspack/config-default');
      let defaultConfig = await processConfig(
        {
          ...require('@atlaspack/config-default'),
          filePath: defaultConfigPath,
        },
        DEFAULT_OPTIONS,
      );
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config',
        '.atlaspackrc',
      );
      let subConfigFilePath = path.join(
        __dirname,
        'fixtures',
        'config',
        'subfolder',
        '.atlaspackrc',
      );
      let {config} = await parseAndProcessConfig(
        subConfigFilePath,
        DEFAULT_OPTIONS.inputFS.readFileSync(subConfigFilePath, 'utf8'),
        DEFAULT_OPTIONS,
      );

      let transformers = nullthrows(config.transformers);
      assert.deepEqual(transformers['*.js'], [
        {
          packageName: 'atlaspack-transformer-sub',
          resolveFrom: relative(subConfigFilePath),
          keyPath: '/transformers/*.js/0',
        },
        {
          packageName: 'atlaspack-transformer-base',
          resolveFrom: relative(configFilePath),
          keyPath: '/transformers/*.js/0',
        },
        '...',
      ]);
      assert(Object.keys(transformers).length > 1);
      assert.deepEqual(config.resolvers, defaultConfig.resolvers);
      assert.deepEqual(config.bundler, defaultConfig.bundler);
      assert.deepEqual(config.namers, defaultConfig.namers || []);
      assert.deepEqual(config.packagers, defaultConfig.packagers || {});
      assert.deepEqual(config.optimizers, defaultConfig.optimizers || {});
      assert.deepEqual(config.reporters, defaultConfig.reporters || []);
    });

    it('should emit a codeframe.codeHighlights when a malformed .atlaspackrc was found', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-malformed',
        '.atlaspackrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      let pos = {
        line: 2,
        column: 14,
      };

      // $FlowFixMe[prop-missing]
      await assert.rejects(
        () => parseAndProcessConfig(configFilePath, code, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: 'Failed to parse .atlaspackrc',
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message: "JSON5: invalid character 'b' at 2:14",
                      start: pos,
                      end: pos,
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    });

    it('should emit a codeframe when an extended atlaspack config file is not found', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-extends-not-found',
        '.atlaspackrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      // $FlowFixMe[prop-missing]
      await assert.rejects(
        () => parseAndProcessConfig(configFilePath, code, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: 'Cannot find extended atlaspack config',
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message:
                        '"./.atlaspckrc-node-modules" does not exist, did you mean "./.atlaspackrc-node-modules"?',
                      start: {line: 2, column: 14},
                      end: {line: 2, column: 41},
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    });

    it('should emit a codeframe when an extended atlaspack config file is not found in JSON5', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-extends-not-found',
        '.atlaspackrc-json5',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      // $FlowFixMe[prop-missing]
      await assert.rejects(
        () => parseAndProcessConfig(configFilePath, code, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: 'Cannot find extended atlaspack config',
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message:
                        '"./.atlaspckrc-node-modules" does not exist, did you mean "./.atlaspackrc-node-modules"?',
                      start: {line: 2, column: 12},
                      end: {line: 2, column: 39},
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    });

    it('should emit a codeframe when an extended atlaspack config node module is not found', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-extends-not-found',
        '.atlaspackrc-node-modules',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      // $FlowFixMe[prop-missing]
      await assert.rejects(
        () => parseAndProcessConfig(configFilePath, code, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: 'Cannot find extended atlaspack config',
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message:
                        'Cannot find module "@atlaspack/config-deflt", did you mean "@atlaspack/config-default"?',
                      start: {line: 2, column: 14},
                      end: {line: 2, column: 38},
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    });

    it('should emit multiple codeframes when multiple extended configs are not found', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-extends-not-found',
        '.atlaspackrc-multiple',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      // $FlowFixMe[prop-missing]
      await assert.rejects(
        () => parseAndProcessConfig(configFilePath, code, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: 'Cannot find extended atlaspack config',
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message:
                        'Cannot find module "@atlaspack/config-deflt", did you mean "@atlaspack/config-default"?',
                      start: {line: 2, column: 15},
                      end: {line: 2, column: 39},
                    },
                  ],
                },
              ],
            },
            {
              message: 'Cannot find extended atlaspack config',
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message:
                        '"./.atlaspckrc" does not exist, did you mean "./.atlaspackrc"?',
                      start: {line: 2, column: 42},
                      end: {line: 2, column: 56},
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    });
  });

  describe('resolve', () => {
    it('should return null if there is no .atlaspackrc file found', async () => {
      let resolved = await resolveAtlaspackConfig(DEFAULT_OPTIONS);
      assert.equal(resolved, null);
    });

    it('should resolve a config if a .atlaspackrc file is found', async () => {
      let resolved = await resolveAtlaspackConfig({
        ...DEFAULT_OPTIONS,
        projectRoot: path.join(__dirname, 'fixtures', 'config', 'subfolder'),
      });

      assert(resolved !== null);
    });
  });
});
