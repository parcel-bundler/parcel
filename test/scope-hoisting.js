const assert = require('assert');
const {bundle, run} = require('./utils');

describe.only('scope hoisting', function() {
  describe('es6', function() {
    it('supports default imports and exports of expressions', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/es6/default-export-expression/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports default imports and exports of declarations', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/es6/default-export-declaration/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports default imports and exports of variables', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/es6/default-export-variable/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports named imports and exports of declarations', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/es6/named-export-declaration/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports named imports and exports of variables', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/named-export-variable/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports renaming imports', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/renamed-import/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports renaming exports', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/renamed-export/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports importing a namespace of exported values', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/import-namespace/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports re-exporting all exports from another module', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/re-export-all/a.js'
      );

      let output = run(b);
      assert.equal(output, 6);
    });

    it('supports re-exporting all exports from multiple modules', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/re-export-multiple/a.js'
      );

      let output = run(b);
      assert.equal(output, 7);
    });

    it('supports re-exporting individual named exports from another module', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/re-export-named/a.js'
      );

      let output = run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting default exports from another module', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/re-export-default/a.js'
      );

      let output = run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting a namespace from another module', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/re-export-namespace/a.js'
      );

      let output = run(b);
      assert.equal(output, 6);
    });

    it('supports multiple exports of the same variable', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/multi-export/a.js'
      );

      let output = run(b);
      assert.equal(output, 6);
    });

    it('supports live bindings of named exports', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/es6/live-bindings/a.js'
      );

      let output = run(b);
      assert.equal(output, 8);
    });
  });

  describe('commonjs', function() {
    it('supports require of commonjs modules', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/commonjs/require/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports default imports of commonjs modules', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/commonjs/default-import/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports named imports of commonjs modules', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/commonjs/named-import/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports namespace imports of commonjs modules', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/commonjs/import-namespace/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 default export of expressions', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-default-export-expression/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 default export of declarations', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-default-export-declaration/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 default export of variables', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-default-export-variable/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 named export of declarations', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-named-export-declaration/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 named export of variables', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-named-export-variable/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 renamed exports', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-renamed-export/a.js'
      );

      let output = run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 module re-exporting all exports from another module', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-re-export-all/a.js'
      );

      let output = run(b);
      assert.equal(output, 7);
    });

    it('supports require of es6 module re-exporting all exports from multiple modules', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-re-export-multiple/a.js'
      );

      let output = run(b);
      assert.equal(output, 7);
    });

    it('supports re-exporting individual named exports from another module', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-re-export-named/a.js'
      );

      let output = run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting default exports from another module', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-re-export-default/a.js'
      );

      let output = run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting a namespace from another module', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/require-re-export-namespace/a.js'
      );

      let output = run(b);
      assert.equal(output, 6);
    });

    it('supports hybrid ES6 + commonjs modules', async function() {
      let b = await bundle(
        __dirname +
          '/integration/scope-hoisting/commonjs/es6-commonjs-hybrid/a.js'
      );

      let output = run(b);
      assert.equal(output, 5);
    });

    it('define exports in the outermost scope', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/commonjs/define-exports/a.js'
      );

      let output = run(b);
      assert.equal(output, 'bar');
    });

    it('supports live bindings of named exports', async function() {
      let b = await bundle(
        __dirname + '/integration/scope-hoisting/commonjs/live-bindings/a.js'
      );

      let output = run(b);
      assert.equal(output, 8);
    });
  });
});
