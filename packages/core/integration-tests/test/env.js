import assert from 'assert';
import path from 'path';
import {bundle, run, removeDistDirectory} from '@parcel/test-utils';

describe.only('env', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should not replace process.env.hasOwnProperty with undefined', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-hasOwnProperty/index.js'),
    );

    let output = await run(b);
    assert.strictEqual(output, false);
  });

  it('should inline NODE_ENV environment variable in browser environment even if disabled', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-nodeenv/index.js'),
      {
        env: {
          FOO: 'abc',
        },
      },
    );

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'test:undefined');
  });

  it('should not insert environment variables in node environment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node/index.js'),
    );

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in electron-main environment', async function () {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-main',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in electron-renderer environment', async function () {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-renderer',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in browser environment if disabled', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-disabled/index.js'),
      {
        env: {FOOBAR: 'abc'},
      },
    );

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'undefined:undefined:undefined');
  });

  it('should only insert environment variables in browser environment matching the glob', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-disabled-glob/index.js'),
      {
        env: {A_1: 'abc', B_1: 'def', B_2: 'ghi'},
      },
    );

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'undefined:def:ghi');
  });

  it('should be able to inline environment variables in browser environment', async function () {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      env: {NODE_ENV: 'abc'},
    });

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'abc:abc');
  });

  it("should insert the user's NODE_ENV as process.env.NODE_ENV if passed", async function () {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      env: {
        NODE_ENV: 'production',
      },
    });

    let output = await run(b);
    assert.ok(!output.toString().includes('process.env'));
    assert.equal(output(), 'production:production');
  });

  it('should not inline computed accesses to process.env', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-computed/index.js'),
      {
        env: {ABC: 'abc'},
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('process.env'));

    let output = await run(b);
    assert.strictEqual(output, undefined);
  });

  it('should inline computed accesses with string literals to process.env', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-computed-string/index.js'),
      {
        env: {ABC: 'XYZ'},
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.strictEqual(output, 'XYZ');
  });

  it('should inline environment variables when destructured in a variable declaration', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-destructuring/index.js'),
      {
        env: {TEST: 'XYZ'},
        defaultTargetOptions: {
          engines: {
            browsers: '>= 0.25%',
          },
        },
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.deepEqual(output, {
      env: {},
      NODE_ENV: 'test',
      renamed: 'XYZ',
      computed: undefined,
      fallback: 'yo',
      rest: {},
      other: 'hi',
    });
  });

  it('should inline environment variables when destructured in an assignment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-destructuring/assign.js'),
      {
        env: {TEST: 'XYZ'},
        defaultTargetOptions: {
          engines: {
            browsers: '>= 0.25%',
          },
        },
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.deepEqual(output, {
      env: {},
      NODE_ENV: 'test',
      renamed: 'XYZ',
      computed: undefined,
      fallback: 'yo',
      rest: {},
      result: {},
    });
  });

  it('should inline environment variables with in binary expression whose right branch is process.env and left branch is string literal', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-binary-in-expression/index.js'),
      {
        env: {ABC: 'any'},
        defaultTargetOptions: {
          engines: {
            browsers: '>= 0.25%',
          },
        },
      },
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('process.env'));

    let output = await run(b);
    assert.deepEqual(output, {
      existVar: 'correct',
      notExistVar: 'correct',
    });
  });

  it('should insert environment variables from a file', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
    );

    // Make sure dotenv doesn't leak its values into the main process's env
    assert(process.env.FOO == null);

    let output = await run(b);
    assert.equal(output, 'bartest');
  });

  it("should insert environment variables matching the user's NODE_ENV if passed", async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
      {env: {NODE_ENV: 'production'}},
    );

    let output = await run(b);
    assert.equal(output, 'productiontest');
  });

  it('should overwrite environment variables from a file if passed', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
      {env: {BAR: 'baz'}},
    );

    let output = await run(b);
    assert.equal(output, 'barbaz');
  });

  it('should insert environment variables from a file even if entry file is specified with source value in package.json', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file-with-package-source'),
    );

    let output = await run(b);
    assert.equal(output, 'bartest');
  });

  it('should error on process.env mutations', async function () {
    let filePath = path.join(__dirname, '/integration/env-mutate/index.js');
    await assert.rejects(bundle(filePath), {
      diagnostics: [
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 1,
                    column: 1,
                  },
                  end: {
                    line: 1,
                    column: 29,
                  },
                },
              ],
            },
          ],
        },
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 2,
                    column: 1,
                  },
                  end: {
                    line: 2,
                    column: 30,
                  },
                },
              ],
            },
          ],
        },
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 3,
                    column: 1,
                  },
                  end: {
                    line: 3,
                    column: 28,
                  },
                },
              ],
            },
          ],
        },
        {
          origin: '@parcel/transformer-js',
          message: 'Mutating process.env is not supported',
          hints: null,
          codeFrames: [
            {
              filePath,
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 4,
                    column: 1,
                  },
                  end: {
                    line: 4,
                    column: 23,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('should warn on process.env mutations in node_modules', async function () {
    let logs = [];
    let disposable = Logger.onLog(d => {
      if (d.level !== 'verbose') {
        logs.push(d);
      }
    });
    let b = await bundle(
      path.join(__dirname, '/integration/env-mutate/warn.js'),
    );
    disposable.dispose();

    assert.deepEqual(logs, [
      {
        type: 'log',
        level: 'warn',
        diagnostics: [
          {
            origin: '@parcel/transformer-js',
            message: 'Mutating process.env is not supported',
            hints: null,
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/env-mutate/node_modules/foo/index.js',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 1,
                      column: 8,
                    },
                    end: {
                      line: 1,
                      column: 36,
                    },
                  },
                ],
              },
            ],
          },
          {
            origin: '@parcel/transformer-js',
            message: 'Mutating process.env is not supported',
            hints: null,
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/env-mutate/node_modules/foo/index.js',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 2,
                      column: 8,
                    },
                    end: {
                      line: 2,
                      column: 35,
                    },
                  },
                ],
              },
            ],
          },
          {
            origin: '@parcel/transformer-js',
            message: 'Mutating process.env is not supported',
            hints: null,
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/env-mutate/node_modules/foo/index.js',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 3,
                      column: 8,
                    },
                    end: {
                      line: 3,
                      column: 30,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    let output = [];
    await run(b, {
      output(o) {
        output.push(o);
      },
    });
    assert.deepEqual(output, ['foo', true, undefined]);
  });

  it('should replace __dirname and __filename with path relative to asset.filePath', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node-replacements/index.js'),
    );

    let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(
      dist.includes(
        'resolve(__dirname, "../test/integration/env-node-replacements")',
      ),
    );
    assert(
      dist.includes(
        'resolve(__dirname, "../test/integration/env-node-replacements/other")',
      ),
    );
    assert(
      dist.includes(
        'resolve(__dirname, "../test/integration/env-node-replacements", "index.js")',
      ),
    );
    assert(
      dist.includes(
        'resolve(__dirname, "../test/integration/env-node-replacements/sub")',
      ),
    );
    assert(
      dist.includes(
        'resolve(__dirname, "../test/integration/env-node-replacements/sub", "index.js")',
      ),
    );
    let f = await run(b);
    let output = f();
    assert.equal(output.data, 'hello');
    assert.equal(output.other, 'hello');
    assert.equal(
      output.firstDirnameTest,
      path.join(__dirname, '/integration/env-node-replacements/data'),
    );
    assert.equal(
      output.secondDirnameTest,
      path.join(__dirname, '/integration/env-node-replacements/other-data'),
    );
    assert.equal(
      output.firstFilenameTest,
      path.join(__dirname, '/integration/env-node-replacements/index.js'),
    );
    assert.equal(
      output.secondFilenameTest,
      path.join(
        __dirname,
        '/integration/env-node-replacements/index.js?query-string=test',
      ),
    );
    assert.equal(
      output.sub.dirname,
      path.join(__dirname, '/integration/env-node-replacements/sub'),
    );
    assert.equal(
      output.sub.filename,
      path.join(__dirname, '/integration/env-node-replacements/sub/index.js'),
    );
  });

  it('should replace __dirname and __filename with path relative to asset.filePath with scope hoisting', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node-replacements/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: false,
        },
      },
    );

    let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(
      dist.includes(
        'path.resolve(__dirname, "../test/integration/env-node-replacements")',
      ),
    );
    assert(
      dist.includes(
        'path.resolve(__dirname, "../test/integration/env-node-replacements/other")',
      ),
    );
    assert(
      dist.includes(
        'path.resolve(__dirname, "../test/integration/env-node-replacements", "index.js")',
      ),
    );
    assert(
      dist.includes(
        'path.resolve(__dirname, "../test/integration/env-node-replacements/sub")',
      ),
    );
    assert(
      dist.includes(
        'path.resolve(__dirname, "../test/integration/env-node-replacements/sub", "index.js")',
      ),
    );
    let f = await run(b);
    let output = f();
    assert.equal(output.data, 'hello');
    assert.equal(output.other, 'hello');
    assert.equal(
      output.firstDirnameTest,
      path.join(__dirname, '/integration/env-node-replacements/data'),
    );
    assert.equal(
      output.secondDirnameTest,
      path.join(__dirname, '/integration/env-node-replacements/other-data'),
    );
    assert.equal(
      output.firstFilenameTest,
      path.join(__dirname, '/integration/env-node-replacements/index.js'),
    );
    assert.equal(
      output.secondFilenameTest,
      path.join(
        __dirname,
        '/integration/env-node-replacements/index.js?query-string=test',
      ),
    );
    assert.equal(
      output.sub.dirname,
      path.join(__dirname, '/integration/env-node-replacements/sub'),
    );
    assert.equal(
      output.sub.filename,
      path.join(__dirname, '/integration/env-node-replacements/sub/index.js'),
    );
  });
});
