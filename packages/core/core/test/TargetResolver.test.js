// @flow

import assert from 'assert';
import path from 'path';
import tempy from 'tempy';
import {inputFS as fs} from '@parcel/test-utils';

import TargetResolver from '../src/TargetResolver';

const COMMON_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/common-targets'
);

const CUSTOM_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/custom-targets'
);

describe('TargetResolver', () => {
  let targetResolver;
  let cacheDir;
  beforeEach(() => {
    targetResolver = new TargetResolver(fs);
    cacheDir = tempy.directory();
  });

  afterEach(() => {
    return fs.rimraf(cacheDir);
  });

  it('resolves exactly specified targets', async () => {
    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH, cacheDir, {
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
      }),
      [
        {
          name: 'customA',
          publicUrl: undefined,
          distDir: path.resolve('customA'),
          env: {
            context: 'browser',
            includeNodeModules: true,
            engines: {
              browsers: ['> 0.25%']
            }
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
            }
          },
          sourceMap: undefined
        }
      ]
    );
  });

  it('resolves common targets from package.json', async () => {
    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH, cacheDir, {}),
      [
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
            includeNodeModules: false
          },
          sourceMap: undefined
        },
        {
          name: 'module',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/module'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            context: 'node',
            engines: {
              node: '>= 12.0.0'
            },
            includeNodeModules: false
          },
          sourceMap: {
            inlineSources: true
          }
        },
        {
          name: 'browser',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/browser'),
          distEntry: 'index.js',
          publicUrl: '/assets',
          env: {
            context: 'browser',
            engines: {
              browsers: ['last 1 version']
            },
            includeNodeModules: true
          },
          sourceMap: undefined
        }
      ]
    );
  });

  it('resolves custom targets from package.json', async () => {
    assert.deepEqual(
      await targetResolver.resolve(CUSTOM_TARGETS_FIXTURE_PATH, cacheDir, {}),
      [
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
            includeNodeModules: false
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
            includeNodeModules: true
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
            includeNodeModules: true
          },
          sourceMap: undefined
        }
      ]
    );
  });

  it('resolves a subset of package.json targets when given a list of names', async () => {
    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH, cacheDir, {
        targets: ['main', 'browser']
      }),
      [
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
            includeNodeModules: false
          },
          sourceMap: undefined
        },
        {
          name: 'browser',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/browser'),
          distEntry: 'index.js',
          publicUrl: '/assets',
          env: {
            context: 'browser',
            engines: {
              browsers: ['last 1 version']
            },
            includeNodeModules: true
          },
          sourceMap: undefined
        }
      ]
    );
  });
});
