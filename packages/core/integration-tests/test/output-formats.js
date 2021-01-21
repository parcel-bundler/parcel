import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {
  assertBundles,
  assertESMExports,
  bundle as _bundle,
  outputFS,
  run,
  runBundle,
} from '@parcel/test-utils';
import * as react from 'react';
import * as lodash from 'lodash';
import * as lodashFP from 'lodash/fp';

const bundle = (name, opts) => _bundle(name, {scopeHoist: true, ...opts});

describe('output formats', function() {
  describe('commonjs', function() {
    it('should support commonjs output (exports)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs/exports.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('exports.bar = '));
      assert(dist.includes('exports.foo = '));
      assert.equal((await run(b)).bar, 5);
    });

    it('should support commonjs output (module.exports)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs/module-exports.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('module.exports = '));
      assert.equal(await run(b), 5);
    });

    it('should support commonjs output from esmodule input', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-commonjs/a.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('exports.bar'));
      assert.equal((await run(b)).bar, 5);
    });

    it('should support commonjs output from esmodule input (re-export rename)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-commonjs/re-export-rename.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('exports.default'));
      assert.equal((await run(b)).default, 2);
    });

    it.skip('should support commonjs output from esmodule input (re-export namespace as)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-commonjs/re-export-namespace-as.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.ns'));
      let output = await run(b);
      assert.equal(output.ns.default, 4);
      assert.equal(output.ns.bar, 5);
    });

    it('should support commonjs output from esmodule input (same binding multiple exports)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-commonjs/multiple-times.js',
        ),
      );

      assert.deepStrictEqual(await run(b), {
        default: 1,
        test: 1,
        other: 1,
        foo: 2,
      });
    });

    it('should support commonjs output from esmodule input (skipped exports)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-commonjs-isLibrary-false/skipped.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('foo')); // no iife
      assert.deepEqual(await run(b), {});
    });

    it('should support commonjs output with external modules (require)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/require.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('require("lodash")'));
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (named import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-external/named.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(/var {\s*add\s*} = require\("lodash"\)/.test(dist));
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (named import with same name)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/named-same.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(/var {\s*assign\s*} = require\("lodash\/fp"\)/.test(dist));
      let match = dist.match(
        /var {\s*assign:\s*(.*)\s*} = require\("lodash"\)/,
      );
      assert(match);
      assert.notEqual(match[1], 'assign');
      assert.equal((await run(b)).bar, true);
    });

    it('should support commonjs output with external modules (namespace import)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/namespace.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(
        dist.includes(
          'var _lodash = $parcel$exportWildcard({}, require("lodash"))',
        ),
      );
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (default import)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/default.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(
        dist.includes(
          'var _lodash = $parcel$interopDefault(require("lodash"))',
        ),
      );
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with external modules (multiple specifiers)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-external/multiple.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var _lodash3 = require("lodash")'));
      assert(
        dist.includes('var _lodash2 = $parcel$exportWildcard({}, _lodash3)'),
      );
      assert(dist.includes('var _lodash = $parcel$interopDefault(_lodash3)'));
      assert(/var {\s*add\s*} = _lodash3/);
      assert.equal((await run(b)).bar, 6);
    });

    it('should support commonjs output with old node without destructuring (single)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-node/single.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var add = require("lodash").add'));
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with old node without destructuring (multiple single with same name)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-node/single-same.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var assign = require("lodash/fp").assign;'));
      assert(dist.includes('var _assign = require("lodash").assign;'));
      assert.equal((await run(b)).bar, true);
    });

    it('should support commonjs output with old node without destructuring (multiple)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-node/multiple.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var _temp = require("lodash")'));
      assert(dist.includes('var add = _temp.add'));
      assert(dist.includes('var subtract = _temp.subtract'));
      assert.equal((await run(b)).bar, 2);
    });

    it('should support commonjs output with old browsers without destructuring (single)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-browsers/single.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var add = require("lodash").add'));
    });

    it('should support commonjs output with old node without destructuring (multiple)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-browsers/multiple.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var _temp = require("lodash")'));
      assert(dist.includes('var add = _temp.add'));
      assert(dist.includes('var subtract = _temp.subtract'));
    });

    it('should support importing sibling bundles in library mode', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-siblings/a.js'),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(dist.includes('exports.foo'));
      assert(dist.includes('require("./index.css")'));
    });

    it('should support async imports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-async/index.js'),
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8',
      );
      assert(
        /Promise\.resolve\(require\("\.\/" \+ "async\..+?\.js"\)\)/.test(index),
      );

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8',
      );
      assert(async.includes('exports.foo = '));
    });

    it('should support async split bundles', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-split/index.js'),
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8',
      );
      assert(
        /Promise\.resolve\(require\("\.\/" \+ "async1\..+?\.js"\)\)/.test(
          index,
        ),
      );
      assert(
        /Promise\.resolve\(require\("\.\/" \+ "async2\..+?\.js"\)\)/.test(
          index,
        ),
      );

      let sharedBundle = b
        .getBundles()
        .find(b => b.name.startsWith('async1') && !index.includes(b.name));
      let shared = await outputFS.readFile(sharedBundle.filePath, 'utf8');

      assert(shared.includes('exports.$'));

      let async1 = await outputFS.readFile(
        b
          .getBundles()
          .find(
            b => b.name.startsWith('async1') && b.name !== sharedBundle.name,
          ).filePath,
        'utf8',
      );
      assert(
        new RegExp(
          `var {\\s*(.|\\n)+\\s*} = require\\("\\.\\/${sharedBundle.name}"\\)`,
        ).test(async1),
      );

      let async2 = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async2')).filePath,
        'utf8',
      );
      assert(
        new RegExp(
          `var {\\s*(.|\\n)+\\s*} = require\\("\\.\\/${sharedBundle.name}"\\)`,
        ).test(async2),
      );
    });

    it('should support async split bundles (reexport default)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-split-reexport-default/index.js',
        ),
      );

      assertBundles(b, [
        {
          name: 'index.js',
          assets: ['index.js', 'JSRuntime.js', 'JSRuntime.js'],
        },
        {
          type: 'js',
          assets: ['shared.js'],
        },
        {
          type: 'js',
          assets: ['async1.js'],
        },
        {
          type: 'js',
          assets: ['async2.js'],
        },
      ]);

      assert.strictEqual(await run(b), 20579 * 2);
    });

    it('should call init for wrapped modules when codesplitting to to commonjs', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-wrap-codesplit/a.js',
        ),
      );

      let mainBundle = b.getBundles().find(b => b.name === 'index.js');
      let [childBundle] = b.getChildBundles(mainBundle);

      let mainBundleContents = await outputFS.readFile(
        mainBundle.filePath,
        'utf8',
      );
      let childBundleContents = await outputFS.readFile(
        childBundle.filePath,
        'utf8',
      );

      assert(
        /exports.\$[a-f0-9]+\$init = \$[a-f0-9]+\$init;/.test(
          mainBundleContents,
        ),
      );
      assert(
        /var {\s*\$[a-f0-9]+\$init\s*} = require\("\.\/index\.js"\);/.test(
          childBundleContents,
        ),
      );

      // TODO uncoment after https://github.com/parcel-bundler/parcel/issues/3989 is fixed
      // assert.equal(await run(b), 2);
    });

    it('should support sideEffects: false', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-sideeffects/index.js',
        ),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(dist.includes('function test'));
      assert(dist.includes('exports.test = test;'));
    });

    it('should throw an error on missing export with esmodule input and sideEffects: false', async function() {
      let message = "other.js does not export 'a'";
      let source = 'missing-export.js';
      await assert.rejects(
        () =>
          bundle(
            path.join(
              __dirname,
              '/integration/formats/commonjs-sideeffects',
              source,
            ),
          ),
        {
          name: 'BuildError',
          message,
          diagnostics: [
            {
              message,
              origin: '@parcel/core',
              filePath: source,
              language: 'js',
              codeFrame: {
                codeHighlights: [
                  {
                    start: {
                      line: 1,
                      column: 10,
                    },
                    end: {
                      line: 1,
                      column: 15,
                    },
                  },
                ],
              },
            },
          ],
        },
      );
    });

    it('should support commonjs input', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-dynamic/index.js'),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(dist.includes('Object.assign(exports'));
    });

    it('should support commonjs requires without interop', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-require/index.js'),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(dist.includes('= require("lodash")'));
    });

    it('should support generating commonjs output with re-exports in entry', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-entry-re-export/a.js',
        ),
      );
      assert.deepEqual(await run(b), {default: 'default'});
    });
  });

  describe('esmodule', function() {
    it('should support esmodule output (named export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/named.js'),
      );

      await assertESMExports(b, {bar: 5, foo: 2});
    });

    it('should support esmodule output (default identifier)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/default-value.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!dist.includes('function')); // no iife
      assert(dist.includes('var _default = $'));
      assert(dist.includes('export default _default'));
      await assertESMExports(b, {default: 4});
    });

    it('should support esmodule output (default function)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/default-function.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export default function'));
      assert.strictEqual((await run(b)).default(), 2);
    });

    it('should support esmodule output (multiple)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/multiple.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export {a, c}'));
      assert(dist.includes('export default'));
      await assertESMExports(b, {a: 2, c: 5, default: 3});
    });

    it('should support esmodule output (exporting symbol multiple times)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/multiple-times.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export {test, test as other, foo};'));
      assert(dist.includes('export default test;'));
      await assertESMExports(b, {default: 1, foo: 2, other: 1, test: 1});
    });

    it('should support esmodule output (re-export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/re-export.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export {a, c}'));
      assert(!dist.includes('export default'));
      await assertESMExports(b, {a: 2, c: 5});
    });

    it.skip('should support esmodule output (re-export namespace as)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm/re-export-namespace-as.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export var ns'));
      await assertESMExports(b, {ns: {a: 2, c: 5}});
    });

    it('should support esmodule output (renaming re-export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/re-export-rename.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export var foo'));
      assert(!dist.includes('export default'));
      await assertESMExports(b, {foo: 4});
    });

    it('should support esmodule output with external modules (named import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/named.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import {add} from "lodash"'));
      await assertESMExports(
        b,
        {bar: 3},
        {lodash: () => ({add: (a, b) => a + b})},
      );
    });

    it('should support esmodule output with external modules (named import with same name)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/named-same.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import {assign} from "lodash/fp"'));
      assert(dist.includes('import {assign as _assign} from "lodash"'));
      assert(dist.includes('assign !== _assign'));
      await assertESMExports(
        b,
        {bar: true},
        {
          lodash: () => lodash,
          'lodash/fp': () => lodashFP,
        },
      );
    });

    it('should support esmodule output with external modules (namespace import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/namespace.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import * as _lodash from "lodash"'));
    });

    it('should support esmodule output with external modules (default import)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/default.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import _lodash from "lodash"'));
      await assertESMExports(
        b,
        {bar: 3},
        {
          lodash: () => lodash,
        },
      );
    });

    it('should support esmodule output with external modules (multiple specifiers)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/multiple.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export const bar'));
      assert(dist.includes('import _lodash, * as _lodash2 from "lodash"'));
      assert(dist.includes('import {add} from "lodash"'));
      await assertESMExports(
        b,
        {bar: 6},
        {
          lodash: () => lodash,
        },
      );
    });

    it('should support esmodule output with external modules (export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/export.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('import {add} from "lodash"'));
      assert(dist.includes('export {add}'));
      await assertESMExports(
        b,
        3,
        {
          lodash: () => lodash,
        },
        ns => ns.add(1, 2),
      );
    });

    it('should support esmodule output with external modules (re-export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-external/re-export.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('import {add} from "lodash"'));
      assert(dist.includes('export {add}'));
      await assertESMExports(
        b,
        3,
        {
          lodash: () => lodash,
        },
        ns => ns.add(1, 2),
      );
    });

    it('should support importing sibling bundles in library mode', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-siblings/a.js'),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(dist.includes('export const foo'));
      assert(dist.includes('import "./index.css"'));
    });

    it('should support esmodule output (skipped exports)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-isLibrary-false/skipped.js',
        ),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(!dist.includes('foo'));
    });

    it('should support interop imports from other bundles', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-interop-cross-bundle/a.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['a.js', 'c.js', 'JSRuntime.js'],
        },
        {
          type: 'js',
          assets: ['b.js'],
        },
      ]);

      let dist = await outputFS.readFile(
        b.getBundles().find(b => !b.isEntry).filePath,
        'utf8',
      );
      assert(dist.includes('$parcel$interopDefault'));
      let ns = await run(b);
      assert.deepEqual(await ns.default, [123, 123]);
    });

    it('should rename imports that conflict with exports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-conflict/a.js'),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('import {foo as _foo} from "foo";'));
      assert(dist.includes('export const foo = _foo + 3;'));
      await assertESMExports(b, {foo: 13}, {foo: () => ({foo: 10})});
    });

    it('should support async imports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-async/index.js'),
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8',
      );
      assert(/import\("\.\/" \+ "async\..+?\.js"\)/.test(index));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8',
      );
      assert(async.includes('export const foo'));
      await assertESMExports(b, 4, {}, ns => ns.default);
    });

    // This is currently not possible, it would have to do something like this:
    // export { $id$init().foo as foo };
    it.skip('should support dynamic imports with chained reexports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-async-chained-reexport/index.js',
        ),
      );

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('c')).filePath,
        'utf8',
      );
      assert(!/\$export\$default\s+=/.test(async));
    });

    it('should support dynamic imports with chained reexports II', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-async-chained-reexport2/index.js',
        ),
      );

      let async = await outputFS.readFile(
        b.getChildBundles(b.getBundles().find(b => b.isEntry))[0].filePath,
        'utf8',
      );
      assert(!async.includes('$import$'));
      await assertESMExports(b, ['index', 'a', 1], {}, ns => ns.default);
    });

    it('should throw an error on missing export with esmodule output and sideEffects: false', async function() {
      let message = "b.js does not export 'a'";
      let source = 'missing-export.js';
      await assert.rejects(
        () =>
          bundle(
            path.join(__dirname, 'integration/formats/esm-sideeffects', source),
          ),
        {
          name: 'BuildError',
          message,
          diagnostics: [
            {
              message,
              origin: '@parcel/core',
              filePath: source,
              language: 'js',
              codeFrame: {
                codeHighlights: [
                  {
                    start: {
                      line: 1,
                      column: 10,
                    },
                    end: {
                      line: 1,
                      column: 15,
                    },
                  },
                ],
              },
            },
          ],
        },
      );
    });

    it('should support async split bundles', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-split/index.js'),
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8',
      );
      assert(/import\("\.\/" \+ "async1\..+?\.js"\)/.test(index));
      assert(/import\("\.\/" \+ "async2\..+?\.js"\)/.test(index));

      let sharedBundle = b
        .getBundles()
        .find(b => b.name.startsWith('async1') && !index.includes(b.name));
      let shared = await outputFS.readFile(sharedBundle.filePath, 'utf8');
      assert(/export {\$[a-f0-9]+\$init, \$[a-f0-9]+\$init}/.test(shared));

      let async1 = await outputFS.readFile(
        b
          .getBundles()
          .find(
            b => b.name.startsWith('async1') && b.name !== sharedBundle.name,
          ).filePath,
        'utf8',
      );
      assert(
        new RegExp(`import {.+} from "\\.\\/${sharedBundle.name}"`).test(
          async1,
        ),
      );

      let async2 = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async2')).filePath,
        'utf8',
      );
      assert(
        new RegExp(`import {.+} from "\\.\\/${sharedBundle.name}"`).test(
          async2,
        ),
      );

      await assertESMExports(
        b,
        true,
        {lodash: () => lodash, react: () => react},
        ns => ns.default,
      );
    });

    it('should call init for wrapped modules when codesplitting to esmodules', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-wrap-codesplit/a.js'),
      );

      let mainBundle = b.getBundles().find(b => b.name === 'index.js');
      let [childBundle] = b.getChildBundles(mainBundle);

      let mainBundleContents = await outputFS.readFile(
        mainBundle.filePath,
        'utf8',
      );
      let childBundleContents = await outputFS.readFile(
        childBundle.filePath,
        'utf8',
      );

      assert(/export {\$[a-f0-9]+\$init}/.test(mainBundleContents));
      assert(
        /import {\$[a-f0-9]+\$init} from "\.\/index\.js"/.test(
          childBundleContents,
        ),
      );
      let ns = await run(b);
      assert.deepStrictEqual({...(await ns.default)}, {default: 2});
    });

    it('should support async split bundles for workers', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-split-worker/index.html',
        ),
      );

      let workerBundle = nullthrows(
        b.getBundles().find(b => b.env.context === 'web-worker'),
      );
      let workerBundleContents = await outputFS.readFile(
        workerBundle.filePath,
        'utf8',
      );

      let asyncBundle = b
        .getChildBundles(workerBundle)
        .find(b => b.filePath.includes('async'));
      let syncBundle = b
        .getReferencedBundles(workerBundle)
        .find(b => !b.filePath.includes('async'));

      assert(
        new RegExp(
          `\\$[a-f0-9]+\\$exports\\s*=\\s*\\(import\\("\\./"\\s*\\+\\s*"${path.basename(
            syncBundle.filePath,
          )}"\\),\\s*import\\("\\./"\\s*\\+\\s*"${path.basename(
            asyncBundle.filePath,
          )}"\\)\\);`,
        ).test(workerBundleContents),
      );
    });

    it('should support building esmodules for browser targets', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-browser/index.html'),
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8',
      );

      assert(html.includes('<script type="module" src="/index'));

      let entry = await outputFS.readFile(
        b.getBundles().find(b => b.name === html.match(/src="\/(.*?)"/)[1])
          .filePath,
        'utf8',
      );

      let asyncBundle = b
        .getBundles()
        .find(bundle => bundle.name.startsWith('async'));
      assert(entry.includes(`import("./" + "${asyncBundle.name}")`));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8',
      );
      assert(async.includes('export const foo'));
    });

    it('should support use an import polyfill for older browsers', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-browser/index.html'),
        {
          defaultEngines: {
            browsers: [
              // Implements es modules but not dynamic imports
              'Chrome 61',
            ],
          },
        },
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8',
      );

      assert(html.includes('<script type="module" src="/index'));

      let entry = await outputFS.readFile(
        b.getBundles().find(b => b.name === html.match(/src="\/(.*?)"/)[1])
          .filePath,
        'utf8',
      );
      assert(entry.includes('function importModule'));

      let asyncBundle = b
        .getBundles()
        .find(bundle => bundle.name.startsWith('async'));
      assert(entry.includes(`getBundleURL() + "${asyncBundle.name}"`));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8',
      );
      assert(async.includes('export const foo'));
    });

    it('should support building esmodules with css imports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-browser-css/index.html'),
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8',
      );

      assert(html.includes('<script type="module" src="/index'));
      assert(html.includes('<link rel="stylesheet" href="/index'));

      let entry = await outputFS.readFile(
        b.getBundles().find(b => b.name === html.match(/src="\/(.*?)"/)[1])
          .filePath,
        'utf8',
      );

      let bundles = b.getBundles();
      let asyncJsBundle = bundles.find(
        bundle => bundle.type === 'js' && bundle.name.startsWith('async'),
      );
      let asyncCssBundle = bundles.find(
        bundle => bundle.type === 'css' && bundle.name.startsWith('async'),
      );
      assert(
        new RegExp(
          'Promise.all\\(\\[.+?getBundleURL\\(\\) \\+ "' +
            asyncCssBundle.name +
            '"\\), import\\("\\.\\/" \\+ "' +
            asyncJsBundle.name +
            '"\\)\\]\\)',
        ).test(entry),
      );

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js' && b.name.startsWith('async'))
          .filePath,
        'utf8',
      );
      assert(async.includes('export const foo'));
      assert(!async.includes('.css"'));
    });

    it('should support building esmodules with split bundles', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-browser-split-bundle/index.html',
        ),
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8',
      );

      assert(html.includes('<script type="module" src="/index'));

      let bundles = b.getBundles();
      let entry = await outputFS.readFile(
        bundles.find(b => b.name === html.match(/src="\/(.*?)"/)[1]).filePath,
        'utf8',
      );

      let sharedBundle = bundles.find(b => b.getEntryAssets().length === 0);
      let async1Bundle = bundles.find(
        b => b.name.startsWith('async1') && b.id !== sharedBundle.id,
      );
      let async2Bundle = bundles.find(b => b.name.startsWith('async2'));

      for (let bundle of [async1Bundle, async2Bundle]) {
        // async import both bundles in parallel for performance
        assert(
          entry.includes(
            `import("./" + "${sharedBundle.name}"), import("./" + "${bundle.name}")`,
          ),
        );
      }

      assert(!entry.includes('Promise.all')); // not needed - esmodules will wait for shared bundle

      let shared = await outputFS.readFile(sharedBundle.filePath, 'utf8');
      assert(/export {\$[a-f0-9]+\$init, \$[a-f0-9]+\$init}/.test(shared));

      let async1 = await outputFS.readFile(async1Bundle.filePath, 'utf8');
      assert(
        new RegExp(`import {.+} from "\\.\\/${sharedBundle.name}"`).test(
          async1,
        ),
      );

      let async2 = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async2')).filePath,
        'utf8',
      );
      assert(
        new RegExp(`import {.+} from "\\.\\/${sharedBundle.name}"`).test(
          async2,
        ),
      );
    });

    it('should create correct bundle import for reexports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-bundle-import-reexport/index.js',
        ),
      );

      let dist1 = await outputFS.readFile(
        b.getBundles().filter(b => b.type === 'js')[0].filePath,
        'utf8',
      );
      let dist2 = await outputFS.readFile(
        b.getBundles().filter(b => b.type === 'js')[1].filePath,
        'utf8',
      );

      let exportName = dist1.match(/export {([a-z0-9$]+)}/)[1];
      assert(exportName);

      assert.equal(
        dist2.match(/import {([a-z0-9$]+)} from "\.\/index\.js";/)[1],
        exportName,
      );

      await assertESMExports(
        b,
        ['!!!index!!!', 'DiagramVersion: !!!some name!!!'],
        {},
        ns => ns.default,
      );
    });

    it('should support generating ESM from CommonJS', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-esm/index.js'),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );
      assert(dist.includes('import {add} from "lodash"'));
      assert(dist.includes('add(a, b)'));
      assert(dist.includes('export default'));

      let ns = await run(b, {}, {}, {lodash: () => lodash});
      assert.strictEqual(ns.default(1, 2), 3);
    });

    it('should support re-assigning to module.exports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-esm/re-assign.js'),
      );

      let dist = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js').filePath,
        'utf8',
      );

      let lines = dist.trim('\n').split('\n');
      assert(
        // The last line is a sourcemap comment, second is empty -- test the third-to-last line
        lines[lines.length - 3].startsWith('export default'),
      );
      assert.equal(dist.match(/export default/g).length, 1);

      let ns = await run(b);
      assert.deepStrictEqual({...ns}, {default: 'xyz'});
    });

    it("doesn't support require.resolve calls for excluded assets without commonjs", async function() {
      let message =
        "`require.resolve` calls for excluded assets are only supported with outputFormat: 'commonjs'";
      let source = path.join(
        __dirname,
        '/integration/formats/commonjs-esm/require-resolve.js',
      );
      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message,
        diagnostics: [
          {
            message,
            origin: '@parcel/packager-js',
            filePath: source,
            language: 'js',
            codeFrame: {
              codeHighlights: [
                {
                  start: {
                    line: 1,
                    column: 16,
                  },
                  end: {
                    line: 1,
                    column: 40,
                  },
                },
              ],
            },
          },
        ],
      });
    });

    it('should support generating commonjs output with re-exports in entry', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-esm-entry-re-export/a.js',
        ),
      );
      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('var exports = {}'));
      assert(contents.includes('export default exports'));
      assert(contents.includes('exports.default ='));

      let ns = await run(b);
      assert.deepEqual({...ns}, {default: {default: 'default'}});
    });
  });

  it('should support generating ESM from universal module wrappers', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/formats/commonjs-esm/universal-library.js',
      ),
    );

    let dist = (
      await outputFS.readFile(b.getBundles()[0].filePath, 'utf8')
    ).trim();
    assert.strictEqual(dist.match(/export default/g).length, 1);
    assert(/export default \$\w+\$\w+;(\n+\/\/.*)?$/.test(dist));
  });

  it("doesn't overwrite used global variables", async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/formats/conflict-global/index.js'),
    );

    let cjs = b
      .getBundles()
      .find(b => b.type === 'js' && b.env.outputFormat === 'commonjs');

    let calls = [];
    assert.deepEqual(
      await runBundle(b, cjs, {
        foo(v) {
          calls.push(v);
        },
      }),
      {Map: 2},
    );
    assert.deepEqual(calls, [[['a', 10]]]);

    let esmContents = await outputFS.readFile(
      b
        .getBundles()
        .find(b => b.type === 'js' && b.env.outputFormat === 'esmodule')
        .filePath,
      'utf8',
    );
    assert(esmContents.includes('const _Map'));
    assert(esmContents.includes('_Map as Map'));
    assert(esmContents.includes('new Map'));
  });

  describe('global', function() {
    it('should support async split bundles for workers', async function() {
      await bundle(
        path.join(
          __dirname,
          '/integration/formats/global-split-worker/index.html',
        ),
      );
    });

    it('should throw with external modules', async function() {
      let message =
        'External modules are not supported when building for browser';
      let source = 'index.js';
      await assert.rejects(
        () =>
          bundle(
            path.join(__dirname, 'integration/formats/global-external', source),
          ),
        {
          name: 'BuildError',
          message,
          diagnostics: [
            {
              message,
              origin: '@parcel/packager-js',
              filePath: source,
              language: 'js',
              codeFrame: {
                codeHighlights: [
                  {
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
            },
          ],
        },
      );
    });
  });
});
