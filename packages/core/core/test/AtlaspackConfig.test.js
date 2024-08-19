// @flow strict-local

import AtlaspackConfig from '../src/AtlaspackConfig';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';
import logger from '@atlaspack/logger';
import {inputFS} from '@atlaspack/test-utils';
import {parseAndProcessConfig} from '../src/requests/AtlaspackConfigRequest';
import {DEFAULT_OPTIONS} from './test-utils';
import {toProjectPath} from '../src/projectPath';

const ATLASPACKRC_PATH = toProjectPath('/', '/.atlaspackrc');

describe('AtlaspackConfig', () => {
  describe('matchGlobMap', () => {
    let config = new AtlaspackConfig(
      {
        filePath: ATLASPACKRC_PATH,
        bundler: undefined,
        packagers: {
          '*.css': {
            packageName: 'atlaspack-packager-css',
            resolveFrom: ATLASPACKRC_PATH,
            keyPath: '/packagers/*.css',
          },
          '*.js': {
            packageName: 'atlaspack-packager-js',
            resolveFrom: ATLASPACKRC_PATH,
            keyPath: '/packagers/*.js',
          },
        },
      },
      DEFAULT_OPTIONS,
    );

    it('should return null array if no glob matches', () => {
      let result = config.matchGlobMap(
        toProjectPath('/', '/foo.wasm'),
        config.packagers,
      );
      assert.deepEqual(result, null);
    });

    it('should return a matching pipeline', () => {
      let result = config.matchGlobMap(
        toProjectPath('/', '/foo.js'),
        config.packagers,
      );
      assert.deepEqual(result, {
        packageName: 'atlaspack-packager-js',
        resolveFrom: ATLASPACKRC_PATH,
        keyPath: '/packagers/*.js',
      });
    });
  });

  describe('matchGlobMapPipelines', () => {
    let config = new AtlaspackConfig(
      {
        filePath: ATLASPACKRC_PATH,
        bundler: undefined,
        transformers: {
          '*.jsx': [
            {
              packageName: 'atlaspack-transform-jsx',
              resolveFrom: ATLASPACKRC_PATH,
              keyPath: '/transformers/*.jsx/0',
            },
            '...',
          ],
          '*.{js,jsx}': [
            {
              packageName: 'atlaspack-transform-js',
              resolveFrom: ATLASPACKRC_PATH,
              keyPath: '/transformers/*.{js,jsx}/0',
            },
          ],
        },
      },
      DEFAULT_OPTIONS,
    );

    it('should return an empty array if no pipeline matches', () => {
      let pipeline = config.matchGlobMapPipelines(
        toProjectPath('/', '/foo.css'),
        config.transformers,
      );
      assert.deepEqual(pipeline, []);
    });

    it('should return a matching pipeline', () => {
      let pipeline = config.matchGlobMapPipelines(
        toProjectPath('/', '/foo.js'),
        config.transformers,
      );
      assert.deepEqual(pipeline, [
        {
          packageName: 'atlaspack-transform-js',
          resolveFrom: ATLASPACKRC_PATH,
          keyPath: '/transformers/*.{js,jsx}/0',
        },
      ]);
    });

    it('should merge pipelines with spread elements', () => {
      let pipeline = config.matchGlobMapPipelines(
        toProjectPath('/', '/foo.jsx'),
        config.transformers,
      );
      assert.deepEqual(pipeline, [
        {
          packageName: 'atlaspack-transform-jsx',
          resolveFrom: ATLASPACKRC_PATH,
          keyPath: '/transformers/*.jsx/0',
        },
        {
          packageName: 'atlaspack-transform-js',
          resolveFrom: ATLASPACKRC_PATH,
          keyPath: '/transformers/*.{js,jsx}/0',
        },
      ]);
    });
  });

  describe('loadPlugin', () => {
    it('should warn if a plugin needs to specify an engines.atlaspack field in package.json', async () => {
      let projectRoot = path.join(__dirname, 'fixtures', 'plugins');
      let configFilePath = toProjectPath(
        projectRoot,
        path.join(__dirname, 'fixtures', 'plugins', '.atlaspackrc'),
      );
      let config = new AtlaspackConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: 'atlaspack-transformer-no-engines',
                resolveFrom: configFilePath,
                keyPath: '/transformers/*.js/0',
              },
            ],
          },
        },
        {...DEFAULT_OPTIONS, projectRoot},
      );

      let warnStub = sinon.stub(logger, 'warn');
      let {plugin} = await config.loadPlugin({
        packageName: 'atlaspack-transformer-no-engines',
        resolveFrom: configFilePath,
        keyPath: '/transformers/*.js/0',
      });
      assert(plugin);
      assert.equal(typeof plugin.transform, 'function');
      assert(warnStub.calledOnce);
      assert.deepEqual(warnStub.getCall(0).args[0], {
        origin: '@atlaspack/core',
        message:
          'The plugin "atlaspack-transformer-no-engines" needs to specify a `package.json#engines.atlaspack` field with the supported Atlaspack version range.',
      });
      warnStub.restore();
    });

    it('should error if a plugin specifies an invalid engines.atlaspack field in package.json', async () => {
      let projectRoot = path.join(__dirname, 'fixtures', 'plugins');
      let configFilePath = toProjectPath(
        projectRoot,
        path.join(__dirname, 'fixtures', 'plugins', '.atlaspackrc'),
      );
      let config = new AtlaspackConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: 'atlaspack-transformer-not-found',
                resolveFrom: configFilePath,
                keyPath: '/transformers/*.js/0',
              },
            ],
          },
        },
        {...DEFAULT_OPTIONS, projectRoot},
      );
      // $FlowFixMe[untyped-import]
      let atlaspackVersion = require('../package.json').version;
      let pkgJSON = path.join(
        __dirname,
        'fixtures',
        'plugins',
        'node_modules',
        'atlaspack-transformer-bad-engines',
        'package.json',
      );
      let code = inputFS.readFileSync(pkgJSON, 'utf8');

      // $FlowFixMe
      await assert.rejects(
        () =>
          config.loadPlugin({
            packageName: 'atlaspack-transformer-bad-engines',
            resolveFrom: configFilePath,
            keyPath: '/transformers/*.js/0',
          }),
        {
          name: 'Error',
          diagnostics: [
            {
              message: `The plugin "atlaspack-transformer-bad-engines" is not compatible with the current version of Atlaspack. Requires "5.x" but the current version is "${atlaspackVersion}".`,
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: pkgJSON,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      start: {line: 5, column: 5},
                      end: {line: 5, column: 22},
                      message: undefined,
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    });

    it('should error with a codeframe if a plugin is not resolved', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-plugin-not-found',
        '.atlaspackrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');
      let {config} = await parseAndProcessConfig(
        configFilePath,
        code,
        DEFAULT_OPTIONS,
      );
      let atlaspackConfig = new AtlaspackConfig(config, DEFAULT_OPTIONS);

      // $FlowFixMe
      await assert.rejects(() => atlaspackConfig.getTransformers('test.js'), {
        name: 'Error',
        diagnostics: [
          {
            message: 'Cannot find Atlaspack plugin "@atlaspack/transformer-jj"',
            origin: '@atlaspack/core',
            codeFrames: [
              {
                filePath: configFilePath,
                language: 'json5',
                code,
                codeHighlights: [
                  {
                    start: {line: 4, column: 14},
                    end: {line: 4, column: 40},
                    message: `Cannot find module "@atlaspack/transformer-jj", did you mean "@atlaspack/transformer-js"?`,
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it('should error when using a reserved pipeline name "node:*"', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'config-node-pipeline',
        '.atlaspackrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');

      // $FlowFixMe
      await assert.rejects(
        () => parseAndProcessConfig(configFilePath, code, DEFAULT_OPTIONS),
        {
          name: 'Error',
          diagnostics: [
            {
              message: "Named pipeline 'node:' is reserved.",
              origin: '@atlaspack/core',
              codeFrames: [
                {
                  filePath: configFilePath,
                  language: 'json5',
                  code,
                  codeHighlights: [
                    {
                      message: undefined,
                      start: {
                        line: 4,
                        column: 5,
                      },
                      end: {
                        line: 4,
                        column: 15,
                      },
                    },
                  ],
                },
              ],
              documentationURL:
                'https://parceljs.org/features/dependency-resolution/#url-schemes',
            },
          ],
        },
      );
    });

    it('should support loading local plugins', async () => {
      let projectRoot = path.join(__dirname, 'fixtures', 'plugins');
      let configFilePath = toProjectPath(
        projectRoot,
        path.join(__dirname, 'fixtures', 'plugins', '.atlaspackrc'),
      );
      let config = new AtlaspackConfig(
        {
          filePath: configFilePath,
          bundler: undefined,
          transformers: {
            '*.js': [
              {
                packageName: './local-plugin',
                resolveFrom: configFilePath,
                keyPath: '/transformers/*.js/0',
              },
            ],
          },
        },
        {...DEFAULT_OPTIONS, projectRoot},
      );

      let [{plugin}] = await config.getTransformers(
        toProjectPath('/', '/foo.js'),
      );
      assert(plugin);
      assert.equal(typeof plugin.transform, 'function');
    });

    it('should error on local plugins inside config packages', async () => {
      let configFilePath = path.join(
        __dirname,
        'fixtures',
        'local-plugin-config-pkg',
        '.atlaspackrc',
      );
      let code = await DEFAULT_OPTIONS.inputFS.readFile(configFilePath, 'utf8');
      let {config} = await parseAndProcessConfig(
        configFilePath,
        code,
        DEFAULT_OPTIONS,
      );
      let atlaspackConfig = new AtlaspackConfig(config, DEFAULT_OPTIONS);
      let extendedConfigPath = path.join(
        __dirname,
        'fixtures',
        'local-plugin-config-pkg',
        'node_modules',
        'atlaspack-config-local',
        'index.json',
      );

      // $FlowFixMe
      await assert.rejects(() => atlaspackConfig.getTransformers('test.js'), {
        name: 'Error',
        diagnostics: [
          {
            message:
              'Local plugins are not supported in Atlaspack config packages. Please publish "./local-plugin" as a separate npm package.',
            origin: '@atlaspack/core',
            codeFrames: [
              {
                filePath: extendedConfigPath,
                language: 'json5',
                code: await DEFAULT_OPTIONS.inputFS.readFile(
                  extendedConfigPath,
                  'utf8',
                ),
                codeHighlights: [
                  {
                    start: {line: 5, column: 7},
                    end: {line: 5, column: 22},
                    message: undefined,
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });
});
