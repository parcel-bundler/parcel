// @flow

import assert from 'assert';
import path from 'path';
import tempy from 'tempy';
import {inputFS as fs} from '@parcel/test-utils';
import {DEFAULT_OPTIONS} from './utils';

import TargetResolver from '../src/TargetResolver';

//$FlowFixMe
const rejects = assert.rejects;

const COMMON_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/common-targets'
);

const CUSTOM_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/custom-targets'
);

const INVALID_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-targets'
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

  it('rejects invalid or unknown fields', async () => {
    let targetResolverContext = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        main: {
          // $FlowFixMe intentionally an invalid value
          context: 'xyz',
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () => targetResolverContext.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {message: 'Invalid context for target "main": "xyz"'}
    );

    let targetResolverEngines = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        main: {
          // $FlowFixMe intentionally an invalid value
          engines: 'xyz',
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () => targetResolverEngines.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {message: 'Invalid engines for target "main": xyz'}
    );

    let targetResolverEngines2 = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        main: {
          engines: {
            // $FlowFixMe intentionally an invalid value
            node: ['8.0.0']
          },
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () => targetResolverEngines2.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {message: 'Invalid value for engines.node for target "main": 8.0.0'}
    );

    let targetResolverIncludeNodeModules = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        main: {
          // $FlowFixMe intentionally an invalid value
          includeNodeModules: 'abc',
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () =>
        targetResolverIncludeNodeModules.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {message: 'Invalid value for includeNodeModules for target "main": "abc"'}
    );

    let targetResolverIsLibrary = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        // $FlowFixMe intentionally an invalid value
        main: {
          isLibrary: 'abc',
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () => targetResolverIsLibrary.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {message: 'Invalid value for isLibrary for target "main": "abc"'}
    );

    let targetResolverOutputFormat = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        main: {
          // $FlowFixMe intentionally an invalid value
          outputFormat: 'modules',
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () => targetResolverOutputFormat.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {message: 'Invalid outputFormat for target "main": "modules"'}
    );

    let targetResolverUnknown = new TargetResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        // $FlowFixMe intentionally an invalid value
        main: {
          somethingElse: 'xyz',
          distDir: 'customA'
        }
      }
    });
    await rejects(
      () => targetResolverUnknown.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {
        message:
          'Unexpected properties in descriptor for target "main": "somethingElse"'
      }
    );
  });

  it('rejects invalid or unknown fields in package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);
    await rejects(() => targetResolver.resolve(INVALID_TARGETS_FIXTURE_PATH), {
      message: 'Invalid outputFormat for target "module": "modules"'
    });
  });
});
