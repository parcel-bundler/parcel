const assert = require('assert');
const path = require('path');
const {bundle: _bundle, run, outputFS} = require('@parcel/test-utils');

const bundle = (name, opts = {}) =>
  _bundle(name, Object.assign({scopeHoist: true}, opts));

describe.only('output formats', function() {
  // module, nomodule, no scope hoist, commonjs, import polyfill
  // single entry, dynamic, split bundle, dynamic + css, split bundle in html

  describe('commonjs', function() {
    it('should support commonjs output (exports)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs/exports.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('exports.bar = '));
      assert(dist.includes('exports.foo = '));
      assert.equal((await run(b)).bar, 5);
    });

    it('should support commonjs output (module.exports)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs/module-exports.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('module.exports = '));
      assert.equal(await run(b), 5);
    });

    it('should support commonjs output from esmodule input', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-commonjs/a.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('exports.bar'));
      assert.equal((await run(b)).bar, 5);
    });

    it('should support commonjs output with external modules (require)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/require.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('require("lodash")'));
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (named import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-external/named.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(/var {\s*add\s*} = require\("lodash"\)/);
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (namespace import)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/namespace.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(
        dist.includes(
          'var _lodash = $parcel$exportWildcard({}, require("lodash"))'
        )
      );
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (default import)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/default.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(
        dist.includes('var _lodash = $parcel$interopDefault(require("lodash"))')
      );
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (multiple specifiers)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/multiple.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var _lodash3 = require("lodash")'));
      assert(
        dist.includes('var _lodash2 = $parcel$exportWildcard({}, _lodash3)')
      );
      assert(dist.includes('var _lodash = $parcel$interopDefault(_lodash3)'));
      assert(/var {\s*add\s*} = _lodash3/);
      assert.equal((await run(b)).bar, 6);
    });

    it('should support importing sibling bundles in library mode', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-siblings/a.js')
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8'
      );
      assert(dist.includes('exports.foo'));
      assert(dist.includes('require("./index.css")'));
    });
  });

  describe('esmodule', function() {
    it('should support esmodule output (named export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/named.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('export const foo'));
      assert(dist.includes('export const bar = foo + 3'));
    });

    it('should support esmodule output (default identifier)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/default-value.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('export default $'));
    });

    it('should support esmodule output (default function)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/default-function.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export default function'));
    });

    it('should support esmodule output (multiple)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/multiple.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export { a, c }'));
      assert(dist.includes('export default'));
    });

    it('should support esmodule output with external modules (named import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/named.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import { add } from "lodash"'));
    });

    it('should support esmodule output with external modules (namespace import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/namespace.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import * as _lodash from "lodash"'));
    });

    it('should support esmodule output with external modules (default import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/default.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import _lodash from "lodash"'));
    });

    it('should support esmodule output with external modules (multiple specifiers)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/multiple.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import _lodash, * as _lodash2 from "lodash"'));
      assert(dist.includes('import { add } from "lodash"'));
    });

    it('should support importing sibling bundles in library mode', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-siblings/a.js')
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8'
      );
      assert(dist.includes('export const foo'));
      assert(dist.includes('import "./index.css"'));
    });
  });
});
