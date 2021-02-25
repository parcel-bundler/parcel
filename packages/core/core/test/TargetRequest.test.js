// @flow strict-local

import assert from 'assert';
import path from 'path';
import tempy from 'tempy';
import {inputFS as fs} from '@parcel/test-utils';
import {md} from '@parcel/diagnostic';
import {TargetResolver} from '../src/requests/TargetRequest';
import {DEFAULT_OPTIONS as _DEFAULT_OPTIONS} from './test-utils';

const DEFAULT_OPTIONS = {
  ..._DEFAULT_OPTIONS,
  defaultTargetOptions: {
    ..._DEFAULT_OPTIONS.defaultTargetOptions,
    sourceMaps: true,
  },
};

const COMMON_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/common-targets',
);

const COMMON_TARGETS_IGNORE_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/common-targets-ignore',
);

const CUSTOM_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/custom-targets',
);

const CUSTOM_TARGETS_DISTDIR_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/custom-targets-distdir',
);

const INVALID_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-targets',
);

const INVALID_ENGINES_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-engines',
);

const INVALID_DISTPATH_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-distpath',
);

const DEFAULT_DISTPATH_FIXTURE_PATHS = {
  none: path.join(__dirname, 'fixtures/targets-default-distdir-none'),
  one: path.join(__dirname, 'fixtures/targets-default-distdir-one'),
  two: path.join(__dirname, 'fixtures/targets-default-distdir-two'),
};

const CONTEXT_FIXTURE_PATH = path.join(__dirname, 'fixtures/context');

describe('TargetResolver', () => {
  let cacheDir;
  beforeEach(() => {
    cacheDir = tempy.directory();
  });

  afterEach(() => {
    return fs.rimraf(cacheDir);
  });

  let api = {
    invalidateOnFileCreate() {},
    invalidateOnFileUpdate() {},
    invalidateOnFileDelete() {},
    invalidateOnEnvChange() {},
    invalidateOnOptionChange() {},
    invalidateOnStartup() {},
    getInvalidations() {
      return [];
    },
    runRequest() {
      throw new Error('Not implemented');
    },
    storeResult() {},
    canSkipSubrequest() {
      return false;
    },
    getPreviousResult() {},
    getRequestResult() {},
    getSubRequests() {
      return [];
    },
  };

  it('resolves exactly specified targets', async () => {
    let targetResolver = new TargetResolver(api, {
      ...DEFAULT_OPTIONS,
      targets: {
        customA: {
          context: 'browser',
          distDir: 'customA',
        },
        customB: {
          distDir: 'customB',
          distEntry: 'b.js',
          engines: {
            node: '>= 8.0.0',
          },
        },
      },
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      [
        {
          name: 'customA',
          publicUrl: '/',
          distDir: path.resolve('customA'),
          env: {
            id: 'daa5d206066497852a3e8af4ff268cc2',
            context: 'browser',
            includeNodeModules: true,
            engines: {
              browsers: ['> 0.25%'],
            },
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
        },
        {
          name: 'customB',
          publicUrl: '/',
          distEntry: 'b.js',
          distDir: path.resolve('customB'),
          env: {
            id: '34ed8a19cbe309827ce088ef05ec16c0',
            context: 'node',
            includeNodeModules: false,
            engines: {
              node: '>= 8.0.0',
            },
            outputFormat: 'commonjs',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
        },
      ],
    );
  });

  it('resolves common targets from package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      [
        {
          name: 'main',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/main'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: '237b25561cd65f8cce61cb7f69431d0e',
            context: 'node',
            engines: {
              node: '>= 8.0.0',
            },
            includeNodeModules: false,
            outputFormat: 'commonjs',
            isLibrary: true,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 11,
              line: 2,
            },
            end: {
              column: 30,
              line: 2,
            },
          },
        },
        {
          name: 'module',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/module'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: 'd583f76f4baa21d5805dd2e70f0408bb',
            context: 'browser',
            engines: {
              browsers: ['last 1 version'],
            },
            includeNodeModules: false,
            outputFormat: 'esmodule',
            isLibrary: true,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {
              inlineSources: true,
            },
          },
          loc: {
            filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 13,
              line: 3,
            },
            end: {
              column: 34,
              line: 3,
            },
          },
        },
        {
          name: 'browser',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/browser'),
          distEntry: 'index.js',
          publicUrl: '/assets',
          env: {
            id: 'bea22d0c0a650e5aec8bc0d7815cec1c',
            context: 'browser',
            engines: {
              browsers: ['last 1 version'],
            },
            includeNodeModules: false,
            outputFormat: 'commonjs',
            isLibrary: true,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 14,
              line: 4,
            },
            end: {
              column: 36,
              line: 4,
            },
          },
        },
      ],
    );
  });

  it('allows ignoring common targets from package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_IGNORE_FIXTURE_PATH),
      [
        {
          name: 'app',
          distDir: path.join(COMMON_TARGETS_IGNORE_FIXTURE_PATH, 'dist'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: 'f61da5725403cc01b4448e3dfef40d92',
            context: 'node',
            engines: {
              node: '>= 8.0.0',
            },
            includeNodeModules: false,
            outputFormat: 'commonjs',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: undefined,
          },
          loc: {
            filePath: path.join(
              COMMON_TARGETS_IGNORE_FIXTURE_PATH,
              'package.json',
            ),
            start: {
              column: 10,
              line: 3,
            },
            end: {
              column: 24,
              line: 3,
            },
          },
        },
      ],
    );
  });

  it('resolves custom targets from package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    assert.deepEqual(
      await targetResolver.resolve(CUSTOM_TARGETS_FIXTURE_PATH),
      [
        {
          name: 'main',
          distDir: path.join(__dirname, 'fixtures/custom-targets/dist/main'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: '237b25561cd65f8cce61cb7f69431d0e',
            context: 'node',
            engines: {
              node: '>= 8.0.0',
            },
            includeNodeModules: false,
            outputFormat: 'commonjs',
            isLibrary: true,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(CUSTOM_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 11,
              line: 2,
            },
            end: {
              column: 30,
              line: 2,
            },
          },
        },
        {
          name: 'browserModern',
          distDir: path.join(
            __dirname,
            'fixtures/custom-targets/dist/browserModern',
          ),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: 'c524c8a26560297dd788b80c8aaf63b1',
            context: 'browser',
            engines: {
              browsers: ['last 1 version'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(CUSTOM_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 20,
              line: 3,
            },
            end: {
              column: 48,
              line: 3,
            },
          },
        },
        {
          name: 'browserLegacy',
          distDir: path.join(
            __dirname,
            'fixtures/custom-targets/dist/browserLegacy',
          ),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: '49378be2acf6bc3e42ae8d6c1957f528',
            context: 'browser',
            engines: {
              browsers: ['ie11'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(CUSTOM_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 20,
              line: 4,
            },
            end: {
              column: 48,
              line: 4,
            },
          },
        },
      ],
    );
  });

  it('resolves explicit distDir for custom targets from package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    assert.deepEqual(
      await targetResolver.resolve(CUSTOM_TARGETS_DISTDIR_FIXTURE_PATH),
      [
        {
          name: 'app',
          distDir: path.join(__dirname, 'fixtures/custom-targets-distdir/www'),
          distEntry: undefined,
          publicUrl: 'www',
          env: {
            id: '44f920d1f3957b7c90f0cf224a8a4fba',
            context: 'browser',
            engines: {
              browsers: '> 0.25%',
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: undefined,
        },
      ],
    );
  });

  it('skips targets with custom entry source for default entry', async () => {
    let targetResolver = new TargetResolver(api, {
      ...DEFAULT_OPTIONS,
      targets: {
        customA: {
          context: 'browser',
          distDir: 'customA',
          source: 'customA/index.js',
        },
        customB: {
          distDir: 'customB',
        },
      },
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      [
        {
          name: 'customB',
          distDir: path.resolve('customB'),
          publicUrl: '/',
          env: {
            id: 'daa5d206066497852a3e8af4ff268cc2',
            context: 'browser',
            engines: {
              browsers: ['> 0.25%'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
        },
      ],
    );
  });

  it('skips other targets with custom entry', async () => {
    let targetResolver = new TargetResolver(api, {
      ...DEFAULT_OPTIONS,
      targets: {
        customA: {
          context: 'browser',
          distDir: 'customA',
          source: 'customA/index.js',
        },
        customB: {
          distDir: 'customB',
        },
      },
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH, 'customA'),
      [
        {
          name: 'customA',
          distDir: path.resolve('customA'),
          publicUrl: '/',
          env: {
            id: 'daa5d206066497852a3e8af4ff268cc2',
            context: 'browser',
            engines: {
              browsers: ['> 0.25%'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          source: 'customA/index.js',
        },
      ],
    );
  });

  it('resolves main target with context from package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    assert.deepEqual(await targetResolver.resolve(CONTEXT_FIXTURE_PATH), [
      {
        name: 'main',
        distDir: path.join(__dirname, 'fixtures/context/dist/main'),
        distEntry: 'index.js',
        publicUrl: '/',
        env: {
          id: 'e5e72d0568f12badc74ca83bc3d87d21',
          context: 'node',
          engines: {},
          includeNodeModules: false,
          isLibrary: true,
          outputFormat: 'commonjs',
          shouldOptimize: false,
          shouldScopeHoist: false,
          sourceMap: {},
        },
        loc: {
          filePath: path.join(CONTEXT_FIXTURE_PATH, 'package.json'),
          start: {
            column: 11,
            line: 2,
          },
          end: {
            column: 30,
            line: 2,
          },
        },
      },
    ]);
  });

  it('resolves main target as an application when non-js file extension is used', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    let fixture = path.join(__dirname, 'fixtures/application-targets');
    assert.deepEqual(await targetResolver.resolve(fixture), [
      {
        name: 'main',
        distDir: path.join(fixture, 'dist'),
        distEntry: 'index.html',
        publicUrl: '/',
        env: {
          id: 'c662827151e303ed37b66363ce56741b',
          context: 'browser',
          engines: {},
          includeNodeModules: true,
          isLibrary: false,
          outputFormat: 'global',
          shouldOptimize: false,
          shouldScopeHoist: false,
          sourceMap: {},
        },
        loc: {
          filePath: path.join(fixture, 'package.json'),
          start: {
            column: 11,
            line: 2,
          },
          end: {
            column: 27,
            line: 2,
          },
        },
      },
    ]);
  });

  it('resolves a subset of package.json targets when given a list of names', async () => {
    let targetResolver = new TargetResolver(api, {
      ...DEFAULT_OPTIONS,
      targets: ['main', 'browser'],
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      [
        {
          name: 'main',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/main'),
          distEntry: 'index.js',
          publicUrl: '/',
          env: {
            id: '237b25561cd65f8cce61cb7f69431d0e',
            context: 'node',
            engines: {
              node: '>= 8.0.0',
            },
            includeNodeModules: false,
            outputFormat: 'commonjs',
            isLibrary: true,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 11,
              line: 2,
            },
            end: {
              column: 30,
              line: 2,
            },
          },
        },
        {
          name: 'browser',
          distDir: path.join(__dirname, 'fixtures/common-targets/dist/browser'),
          distEntry: 'index.js',
          publicUrl: '/assets',
          env: {
            id: 'bea22d0c0a650e5aec8bc0d7815cec1c',
            context: 'browser',
            engines: {
              browsers: ['last 1 version'],
            },
            includeNodeModules: false,
            outputFormat: 'commonjs',
            isLibrary: true,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: {
            filePath: path.join(COMMON_TARGETS_FIXTURE_PATH, 'package.json'),
            start: {
              column: 14,
              line: 4,
            },
            end: {
              column: 36,
              line: 4,
            },
          },
        },
      ],
    );
  });

  it('generates a default target in serve mode', async () => {
    let serveDistDir = path.join(DEFAULT_OPTIONS.cacheDir, 'dist');

    let targetResolver = new TargetResolver(api, {
      ...DEFAULT_OPTIONS,
      serveOptions: {distDir: serveDistDir, port: 1234},
    });

    assert.deepEqual(
      await targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      [
        {
          name: 'default',
          distDir: serveDistDir,
          publicUrl: '/',
          env: {
            id: 'c662827151e303ed37b66363ce56741b',
            context: 'browser',
            engines: {},
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
        },
      ],
    );
  });

  it('generates the correct distDir with no explicit targets', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);

    assert.deepEqual(
      await targetResolver.resolve(DEFAULT_DISTPATH_FIXTURE_PATHS.none),
      [
        {
          name: 'default',
          distDir: path.join(DEFAULT_DISTPATH_FIXTURE_PATHS.none, 'dist'),
          publicUrl: '/',
          env: {
            id: 'b3615ef0bf18b4028c140901ca54d959',
            context: 'browser',
            engines: {
              browsers: ['Chrome 80'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
        },
      ],
    );
  });

  it('generates the correct distDir with one explicit target', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);

    assert.deepEqual(
      await targetResolver.resolve(DEFAULT_DISTPATH_FIXTURE_PATHS.one),
      [
        {
          name: 'browserModern',
          distDir: path.join(DEFAULT_DISTPATH_FIXTURE_PATHS.one, 'dist'),
          distEntry: undefined,
          publicUrl: '/',
          env: {
            id: 'b3615ef0bf18b4028c140901ca54d959',
            context: 'browser',
            engines: {
              browsers: ['Chrome 80'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: undefined,
        },
      ],
    );
  });

  it('generates the correct distDirs with two explicit targets', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);

    assert.deepEqual(
      await targetResolver.resolve(DEFAULT_DISTPATH_FIXTURE_PATHS.two),
      [
        {
          name: 'browserModern',
          distDir: path.join(
            DEFAULT_DISTPATH_FIXTURE_PATHS.two,
            'dist',
            'browserModern',
          ),
          distEntry: undefined,
          publicUrl: '/',
          env: {
            id: 'c524c8a26560297dd788b80c8aaf63b1',
            context: 'browser',
            engines: {
              browsers: ['last 1 version'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: undefined,
        },
        {
          name: 'browserLegacy',
          distDir: path.join(
            DEFAULT_DISTPATH_FIXTURE_PATHS.two,
            'dist',
            'browserLegacy',
          ),
          distEntry: undefined,
          publicUrl: '/',
          env: {
            id: '38faa7345dbd1abfb76936779466bc12',
            context: 'browser',
            engines: {
              browsers: ['IE 11'],
            },
            includeNodeModules: true,
            outputFormat: 'global',
            isLibrary: false,
            shouldOptimize: false,
            shouldScopeHoist: false,
            sourceMap: {},
          },
          loc: undefined,
        },
      ],
    );
  });

  it('rejects invalid or unknown fields', async () => {
    let code =
      '{\n' +
      '\t"targets": {\n' +
      '\t\t"main": {\n' +
      '\t\t\t"includeNodeModules": [\n' +
      '\t\t\t\t"react",\n' +
      '\t\t\t\ttrue\n' +
      '\t\t\t],\n' +
      '\t\t\t"context": "nodes",\n' +
      '\t\t\t"outputFormat": "module",\n' +
      '\t\t\t"sourceMap": {\n' +
      '\t\t\t\t"sourceRoot": "asd",\n' +
      '\t\t\t\t"inline": "false",\n' +
      '\t\t\t\t"verbose": true\n' +
      '\t\t\t},\n' +
      '\t\t\t"engines": {\n' +
      '\t\t\t\t"node": "12",\n' +
      '\t\t\t\t"browser": "Chrome 70"\n' +
      '\t\t\t}\n' +
      '\t\t}\n' +
      '\t}\n' +
      '}';
    let targetResolver = new TargetResolver(api, {
      ...DEFAULT_OPTIONS,
      ...JSON.parse(code),
    });

    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () => targetResolver.resolve(COMMON_TARGETS_FIXTURE_PATH),
      {
        message: 'Invalid target descriptor for target "main"',
        diagnostics: [
          {
            message: 'Invalid target descriptor for target "main"',
            origin: '@parcel/core',
            filePath: undefined,
            language: 'json',
            codeFrame: {
              code,
              codeHighlights: [
                {
                  start: {line: 6, column: 5},
                  end: {line: 6, column: 8},
                  message: 'Expected a wildcard or filepath',
                },
                {
                  start: {line: 8, column: 15},
                  end: {line: 8, column: 21},
                  message: 'Did you mean "node"?',
                },
                {
                  start: {line: 9, column: 20},
                  end: {line: 9, column: 27},
                  message: 'Did you mean "esmodule"?',
                },
                {
                  start: {line: 12, column: 15},
                  end: {line: 12, column: 21},
                  message: 'Expected type boolean',
                },
                {
                  start: {line: 13, column: 5},
                  end: {line: 13, column: 13},
                  message: 'Possible values: "inlineSources"',
                },
                {
                  start: {line: 17, column: 5},
                  end: {line: 17, column: 13},
                  message: 'Did you mean "browsers"?',
                },
              ],
            },
          },
        ],
      },
    );
  });

  it('rejects invalid or unknown fields in package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(INVALID_TARGETS_FIXTURE_PATH, 'package.json'),
      'utf8',
    );
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () => targetResolver.resolve(INVALID_TARGETS_FIXTURE_PATH),
      {
        diagnostics: [
          {
            message: 'Invalid target descriptor for target "module"',
            origin: '@parcel/core',
            filePath: path.join(INVALID_TARGETS_FIXTURE_PATH, 'package.json'),
            language: 'json',
            codeFrame: {
              code,
              codeHighlights: [
                {
                  start: {line: 9, column: 29},
                  end: {line: 9, column: 35},
                  message: 'Expected type boolean',
                },
                {
                  start: {line: 11, column: 7},
                  end: {line: 11, column: 17},
                  message: 'Did you mean "publicUrl"?',
                },
              ],
            },
          },
        ],
      },
    );
  });

  it('rejects invalid engines in package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(INVALID_ENGINES_FIXTURE_PATH, 'package.json'),
      'utf8',
    );
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () => targetResolver.resolve(INVALID_ENGINES_FIXTURE_PATH),
      {
        diagnostics: [
          {
            message: 'Invalid engines in package.json',
            origin: '@parcel/core',
            filePath: path.join(INVALID_ENGINES_FIXTURE_PATH, 'package.json'),
            language: 'json',
            codeFrame: {
              code,
              codeHighlights: [
                {
                  end: {
                    column: 13,
                    line: 8,
                  },
                  message: 'Did you mean "browsers"?',
                  start: {
                    column: 5,
                    line: 8,
                  },
                },
                {
                  end: {
                    column: 5,
                    line: 7,
                  },
                  message: 'Expected type string',
                  start: {
                    column: 13,
                    line: 5,
                  },
                },
              ],
            },
          },
        ],
      },
    );
  });

  it('rejects target distpath in package.json', async () => {
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(INVALID_DISTPATH_FIXTURE_PATH, 'package.json'),
      'utf8',
    );
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () => targetResolver.resolve(INVALID_DISTPATH_FIXTURE_PATH),
      {
        diagnostics: [
          {
            message: 'Invalid distPath for target "legacy"',
            origin: '@parcel/core',
            filePath: path.join(INVALID_DISTPATH_FIXTURE_PATH, 'package.json'),
            language: 'json',
            codeFrame: {
              code,
              codeHighlights: [
                {
                  end: {
                    column: 13,
                    line: 2,
                  },
                  message: 'Expected type string',
                  start: {
                    column: 13,
                    line: 2,
                  },
                },
              ],
            },
          },
        ],
      },
    );
  });

  it('rejects duplicate target paths', async () => {
    let fixture = path.join(__dirname, 'fixtures/duplicate-targets');
    let targetResolver = new TargetResolver(api, DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(fixture, 'package.json'),
      'utf8',
    );
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(() => targetResolver.resolve(fixture), {
      diagnostics: [
        {
          message: md`Multiple targets have the same destination path "${path.normalize(
            'dist/index.js',
          )}"`,
          origin: '@parcel/core',
          filePath: path.join(fixture, 'package.json'),
          language: 'json',
          codeFrame: {
            code,
            codeHighlights: [
              {
                end: {
                  column: 25,
                  line: 2,
                },
                message: undefined,
                start: {
                  column: 11,
                  line: 2,
                },
              },
              {
                end: {
                  column: 27,
                  line: 3,
                },
                message: undefined,
                start: {
                  column: 13,
                  line: 3,
                },
              },
            ],
          },
          hints: [
            'Try removing the duplicate targets, or changing the destination paths.',
          ],
        },
      ],
    });
  });
});
