import assert from 'assert';
import path from 'path';
import {bundle, run, ncp, overlayFS, outputFS} from '@parcel/test-utils';

describe('resolver', function() {
  it('should support resolving tilde in monorepo packages', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-tilde-monorepo/client/src/index.js',
      ),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 1234);
  });

  it('should support node: prefix for node_modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-node-prefix/src/index.js'),
    );

    let output = await run(b);
    assert.strictEqual(
      output.default,
      '6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50',
    );
  });

  it('should correctly resolve tilde in node_modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-tilde-nodemodules/index.js'),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 1234);
  });

  it('should fall back to index.js if the resolved `main` file does not exist', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-index-fallback/incorrect-entry.js',
      ),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 42);
  });

  it('should fall back to index.js if there is no `main` field at all', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-index-fallback/no-entry.js'),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 42);
  });

  it('should print a diagnostic when a configured target field will overwrite an entry', async function() {
    let errorThrows = 0;
    const overwriteDirs = ['browser', 'app', 'main', 'module'];
    for (const currDir of overwriteDirs) {
      try {
        await bundle(
          path.join(
            __dirname,
            `integration/target-overwrite-source/${currDir}`,
          ),
        );
      } catch (e) {
        errorThrows++;
        let pkg = JSON.parse(
          await overlayFS.readFile(
            path.join(
              __dirname,
              `integration/target-overwrite-source/${currDir}/package.json`,
            ),
          ),
        );
        assert.deepEqual(
          e.diagnostics[0].message,
          `Target "${currDir}" is configured to overwrite entry "${path.normalize(
            `test/integration/target-overwrite-source/${currDir}/${pkg.source}`,
          )}".`,
        );
      }
    }
    assert.deepEqual(errorThrows, overwriteDirs.length);
  });

  it('should throw an error on Webpack loader imports', async function() {
    let didThrow = false;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/webpack-import-syntax-error/index.js',
        ),
      );
    } catch (e) {
      didThrow = true;
      assert.equal(
        e.diagnostics[1].message,
        `The import path: node-loader!./index.js is using webpack specific loader import syntax, which isn't supported by Parcel.`,
      );
    }

    assert(didThrow);
  });

  it('should throw an error with codeframe on invalid js import', async function() {
    let didThrow = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/js-invalid-import/index.js'),
      );
    } catch (e) {
      didThrow = true;

      assert(
        e.diagnostics[0].message.startsWith(
          `Failed to resolve './doesnotexisstt' from `,
        ),
      );

      assert.deepEqual(e.diagnostics[0].codeFrames[0].codeHighlights[0], {
        start: {line: 1, column: 8},
        end: {line: 1, column: 25},
      });
    }

    assert(didThrow);
  });

  it('should throw an error with codeframe on invalid css import', async function() {
    let didThrow = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/css-invalid-import/index.css'),
      );
    } catch (e) {
      didThrow = true;

      assert(
        e.diagnostics[0].message.startsWith(
          `Failed to resolve './thisdoesnotexist.css' from `,
        ),
      );

      assert.deepEqual(e.diagnostics[0].codeFrames[0].codeHighlights[0], {
        start: {line: 1, column: 9},
        end: {line: 1, column: 32},
      });
    }

    assert(didThrow);
  });

  it('Should return codeframe with hints when package.json is invalid', async function() {
    let didThrow = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/resolver-invalid-pkgjson/index.js'),
      );
    } catch (e) {
      didThrow = true;

      assert.equal(
        e.diagnostics[1].message,
        `Could not load './entryx.js' from module 'invalid-module' found in package.json#main`,
      );

      assert.deepEqual(e.diagnostics[1].codeFrames[0].codeHighlights[0], {
        end: {
          column: 25,
          line: 4,
        },
        message: "'./entryx.js' does not exist, did you mean './entry.js'?'",
        start: {
          column: 13,
          line: 4,
        },
      });
    }

    assert(didThrow);
  });

  it('Should suggest alternative filenames for relative imports', async function() {
    let threw = 0;

    try {
      await bundle(
        path.join(__dirname, '/integration/resolver-alternative-relative/a.js'),
      );
    } catch (e) {
      threw++;

      assert.equal(
        e.diagnostics[1].message,
        `Cannot load file './test/teste.js' in './integration/resolver-alternative-relative'.`,
      );

      assert.equal(
        e.diagnostics[1].hints[0],
        `Did you mean '__./test/test.js__'?`,
      );
    }

    try {
      await bundle(
        path.join(__dirname, '/integration/resolver-alternative-relative/b.js'),
      );
    } catch (e) {
      threw++;

      assert.equal(
        e.diagnostics[1].message,
        `Cannot load file './aa.js' in './integration/resolver-alternative-relative'.`,
      );

      assert.equal(e.diagnostics[1].hints[0], `Did you mean '__./a.js__'?`);
    }

    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/resolver-alternative-relative/test/test.js',
        ),
      );
    } catch (e) {
      threw++;

      assert.equal(
        e.diagnostics[1].message,
        `Cannot load file '../../a.js' in './integration/resolver-alternative-relative/test'.`,
      );

      assert.equal(e.diagnostics[1].hints[0], `Did you mean '__../a.js__'?`);
    }

    assert.equal(threw, 3);
  });

  it('Should suggest alternative modules for module imports', async function() {
    let threw = false;

    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/resolver-alternative-module/index.js',
        ),
      );
    } catch (e) {
      threw = true;

      assert.equal(e.diagnostics[1].message, `Cannot find module @baebal/core`);

      assert.equal(
        e.diagnostics[1].hints[0],
        `Did you mean '__@babel/core__'?`,
      );
    }

    assert(threw);
  });

  it('should resolve packages to packages through the alias field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/alias/package-to-package.js'),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 3);
  });

  it('should resolve packages to local files through the alias field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/alias/package-to-local.js'),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 'bar');
  });

  it('should exclude local files using the alias field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/alias/exclude-local.js'),
    );

    let output = await run(b);
    assert.deepEqual(output.default, {});
  });

  it('should exclude packages using the alias field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/alias/exclude-package.js'),
    );

    let output = await run(b);
    assert.deepEqual(output.default, {});
  });

  it('should support symlinked node_modules structure', async function() {
    const rootDir = path.join(
      __dirname,
      'integration/resolve-symlinked-node_modules-structure',
    );

    await overlayFS.mkdirp(rootDir);
    await ncp(rootDir, rootDir);

    await outputFS.symlink(
      path.join(
        rootDir,
        'node_modules/.origin/library@1.0.0/node_modules/library',
      ),
      path.join(rootDir, 'node_modules/library'),
    );
    await outputFS.symlink(
      path.join(
        rootDir,
        'node_modules/.origin/library-dep@1.0.0/node_modules/library-dep',
      ),
      path.join(
        rootDir,
        'node_modules/.origin/library@1.0.0/node_modules/library-dep',
      ),
    );

    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-symlinked-node_modules-structure/index.js',
      ),
      {
        inputFS: overlayFS,
        outputFS,
      },
    );

    let output = await run(b);
    assert.strictEqual(output.default, 42);
  });

  it('should support symlinked monorepos structure', async function() {
    const rootDir = path.join(
      __dirname,
      'integration/resolve-symlinked-monorepos',
    );

    await overlayFS.mkdirp(rootDir);
    await ncp(rootDir, rootDir);

    await outputFS.symlink(
      path.join(rootDir, 'packages/library'),
      path.join(rootDir, 'packages/app/node_modules/library'),
    );
    await outputFS.symlink(
      path.join(rootDir, 'node_modules/.origin/pkg@1.0.0/node_modules/pkg'),
      path.join(rootDir, 'packages/app/node_modules/pkg'),
    );
    await outputFS.symlink(
      path.join(rootDir, 'node_modules/.origin/pkg@1.0.0/node_modules/pkg'),
      path.join(rootDir, 'packages/library/node_modules/pkg'),
    );

    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-symlinked-monorepos/packages/app/index.js',
      ),
      {
        inputFS: overlayFS,
        outputFS,
      },
    );

    let output = await run(b);
    assert.strictEqual(output.default, 2);
  });

  it('should support very long dependency specifiers', async function() {
    this.timeout(8000);

    let inputDir = path.join(__dirname, 'input');

    await outputFS.mkdirp(inputDir);
    await outputFS.writeFile(
      path.join(inputDir, 'index.html'),
      `<img src="data:image/jpeg;base64,/9j/${'A'.repeat(200000)}">`,
    );

    await bundle(path.join(inputDir, 'index.html'), {
      inputFS: overlayFS,
    });
  });
});
