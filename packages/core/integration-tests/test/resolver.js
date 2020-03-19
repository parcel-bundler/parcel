import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';

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

  it('should correctly resolve tilde in node_modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-tilde-nodemodules/index.js'),
    );

    let output = await run(b);
    assert.strictEqual(output.default, 1234);
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
        e.diagnostics[0].message,
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
          `Cannot find module './doesnotexisstt' from `,
        ),
      );

      assert.deepEqual(e.diagnostics[0].codeFrame.codeHighlights[0], {
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
          `Cannot find module './thisdoesnotexist.css' from `,
        ),
      );

      assert.deepEqual(e.diagnostics[0].codeFrame.codeHighlights[0], {
        start: {line: 1, column: 9},
        end: {line: 1, column: 32},
      });
    }

    assert(didThrow);
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
});
