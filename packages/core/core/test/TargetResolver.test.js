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

const INVALID_TARGETS_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-targets'
);

const INVALID_ENGINES_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-engines'
);

const INVALID_DISTPATH_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-distpath'
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
    let targetResolver = new TargetResolver({
      ...DEFAULT_OPTIONS,
      ...JSON.parse(code)
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
                  message: 'Expected a wildcard or filepath'
                },
                {
                  start: {line: 8, column: 15},
                  end: {line: 8, column: 21},
                  message: 'Did you mean "node"?'
                },
                {
                  start: {line: 9, column: 20},
                  end: {line: 9, column: 27},
                  message: 'Did you mean "esmodule"?'
                },
                {
                  start: {line: 12, column: 15},
                  end: {line: 12, column: 21},
                  message: 'Expected type boolean'
                },
                {
                  start: {line: 13, column: 5},
                  end: {line: 13, column: 13},
                  message: 'Possible values: "inlineSources"'
                },
                {
                  start: {line: 17, column: 5},
                  end: {line: 17, column: 13},
                  message: 'Did you mean "browsers"?'
                }
              ]
            }
          }
        ]
      }
    );
  });

  it('rejects invalid or unknown fields in package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(INVALID_TARGETS_FIXTURE_PATH, 'package.json'),
      'utf8'
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
                  message: 'Expected type boolean'
                },
                {
                  start: {line: 11, column: 7},
                  end: {line: 11, column: 17},
                  message: 'Did you mean "publicUrl"?'
                }
              ]
            }
          }
        ]
      }
    );
  });

  it('rejects invalid engines in package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(INVALID_ENGINES_FIXTURE_PATH, 'package.json'),
      'utf8'
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
                    line: 8
                  },
                  message: 'Did you mean "browsers"?',
                  start: {
                    column: 5,
                    line: 8
                  }
                },
                {
                  end: {
                    column: 5,
                    line: 7
                  },
                  message: 'Expected type string',
                  start: {
                    column: 13,
                    line: 5
                  }
                }
              ]
            }
          }
        ]
      }
    );
  });

  it('rejects target distpath in package.json', async () => {
    let targetResolver = new TargetResolver(DEFAULT_OPTIONS);
    let code = await fs.readFileSync(
      path.join(INVALID_DISTPATH_FIXTURE_PATH, 'package.json'),
      'utf8'
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
                    line: 2
                  },
                  message: 'Expected type string',
                  start: {
                    column: 13,
                    line: 2
                  }
                }
              ]
            }
          }
        ]
      }
    );
  });
});
