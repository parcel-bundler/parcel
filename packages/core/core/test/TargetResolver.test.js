// @flow

import assert from 'assert';
import path from 'path';
import tempy from 'tempy';
import {inputFS as fs} from '@parcel/test-utils';
import {DEFAULT_OPTIONS} from './utils';

import TargetResolver from '../src/TargetResolver';

const COMMON_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/common-targets'
);

const CUSTOM_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/custom-targets'
);

const CONTEXT_FIXTURE_PATH = path.join(__dirname, 'fixtures/context');

describe('TargetResolver', () => {
  let cacheDir;
  beforeEach(() => {
    cacheDir = tempy.directory();
  });

  afterEach(() => {
    return fs.rimraf(cacheDir);
  });

  it('resolves exactly specified targets', async () => {
    let targetResolver = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        customA: {
          context: 'browser',
          distDir: 'customA'
        },
        customB: {
          distDir: 'customB',
          engines: {
            node: '>= 8.0.0'
          }
        }
      }
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {
        files: [],
        targets: [
          {
            name: 'customA',
            publicUrl: undefined,
            distDir: path.resolve('customA'),
            env: {
              context: 'browser',
              includeNodeModules: true,
              engines: {
                browsers: ['> 0.25%']
              },
              outputFormat: 'global',
              isLibrary: false
            },
            sourceMap: undefined
          },
          {
            name: 'customB',
            publicUrl: undefined,
            distDir: path.resolve('customB'),
            env: {
              context: 'node',
              includeNodeModules: false,
              engines: {
                node: '>= 8.0.0'
              },
              outputFormat: 'commonjs',
              isLibrary: false
            },
            sourceMap: undefined
          }
        ]
      }
    );
  });

  it('resolves common targets from package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {
        files: [
          {filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json')}
        ],
        targets: [
          {
            name: 'main',
            distDir: path.join(__dirname, 'fixtures/common-targets/dist/main'),
            distEntry: 'index.js',
            publicUrl: '/',
            env: {
              context: 'node',
              engines: {
                node: '>= 8.0.0'
              },
              includeNodeModules: false,
              outputFormat: 'commonjs',
              isLibrary: true
            },
            sourceMap: undefined
          },
          {
            name: 'module',
            distDir: path.join(
              __dirname,
              'fixtures/common-targets/dist/module'
            ),
            distEntry: 'index.js',
            publicUrl: '/',
            env: {
              context: 'browser',
              engines: {
                browsers: ['last 1 version']
              },
              includeNodeModules: false,
              outputFormat: 'esmodule',
              isLibrary: true
            },
            sourceMap: {
              inlineSources: true
            }
          },
          {
            name: 'browser',
            distDir: path.join(
              __dirname,
              'fixtures/common-targets/dist/browser'
            ),
            distEntry: 'index.js',
            publicUrl: '/assets',
            env: {
              context: 'browser',
              engines: {
                browsers: ['last 1 version']
              },
              includeNodeModules: false,
              outputFormat: 'commonjs',
              isLibrary: true
            },
            sourceMap: undefined
          }
        ]
      }
    );
  });

  it('resolves custom targets from package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);
    assert.deepEqual(
      await targetResolver.resolve(CUSTOM_TARGETS_FIXTURE_PATH),
      {
        files: [
          {filePath: path.join(CUSTOM_TARGETS_FIXTURE_PATH, 'package.json')}
        ],
        targets: [
          {
            name: 'main',
            distDir: path.join(__dirname, 'fixtures/custom-targets/dist/main'),
            distEntry: 'index.js',
            publicUrl: '/',
            env: {
              context: 'node',
              engines: {
                node: '>= 8.0.0'
              },
              includeNodeModules: false,
              outputFormat: 'commonjs',
              isLibrary: true
            },
            sourceMap: undefined
          },
          {
            name: 'browserModern',
            distDir: path.join(
              __dirname,
              'fixtures/custom-targets/dist/browserModern'
            ),
            distEntry: 'index.js',
            publicUrl: '/',
            env: {
              context: 'browser',
              engines: {
                browsers: ['last 1 version']
              },
              includeNodeModules: true,
              outputFormat: 'global',
              isLibrary: false
            },
            sourceMap: undefined
          },
          {
            name: 'browserLegacy',
            distDir: path.join(
              __dirname,
              'fixtures/custom-targets/dist/browserLegacy'
            ),
            distEntry: 'index.js',
            publicUrl: '/',
            env: {
              context: 'browser',
              engines: {
                browsers: ['ie11']
              },
              includeNodeModules: true,
              outputFormat: 'global',
              isLibrary: false
            },
            sourceMap: undefined
          }
        ]
      }
    );
  });

  it('resolves main target with context from package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);
    assert.deepEqual(await targetResolver.resolve(CONTEXT_FIXTURE_PATH), {
      files: [{filePath: path.join(CONTEXT_FIXTURE_PATH, 'package.json')}],
      targets: [
        {
          name: 'main',
          distDir: path.join(__dirname, 'fixtures/context/dist/main'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            context: 'node',
            engines: {
              browsers: [
                'last 1 Chrome version',
                'last 1 Safari version',
                'last 1 Firefox version',
                'last 1 Edge version'
              ]
            },
            includeNodeModules: false,
            isLibrary: true,
            outputFormat: 'commonjs'
          },
          sourceMap: undefined
        }
      ]
    });
  });

  it('resolves a subset of package.json targets when given a list of names', async () => {
    let targetResolver = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: ['main', 'browser']
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {
        files: [
          {filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json')}
        ],
        targets: [
          {
            name: 'main',
            distDir: path.join(__dirname, 'fixtures/common-targets/dist/main'),
            distEntry: 'index.js',
            publicUrl: '/',
            env: {
              context: 'node',
              engines: {
                node: '>= 8.0.0'
              },
              includeNodeModules: false,
              outputFormat: 'commonjs',
              isLibrary: true
            },
            sourceMap: undefined
          },
          {
            name: 'browser',
            distDir: path.join(
              __dirname,
              'fixtures/common-targets/dist/browser'
            ),
            distEntry: 'index.js',
            publicUrl: '/assets',
            env: {
              context: 'browser',
              engines: {
                browsers: ['last 1 version']
              },
              includeNodeModules: false,
              outputFormat: 'commonjs',
              isLibrary: true
            },
            sourceMap: undefined
          }
        ]
      }
    );
  });
});
