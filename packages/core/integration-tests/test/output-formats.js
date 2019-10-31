import assert from 'assert';
import path from 'path';
import {bundle as _bundle, run, outputFS} from '@parcel/test-utils';

const bundle = (name, opts = {}) =>
  _bundle(name, Object.assign({scopeHoist: true}, opts));

describe('output formats', function() {
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
      assert(/var {\s*add\s*} = require\("lodash"\)/.test(dist));
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

    it('should support commonjs output with old node without destructuring (single)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-node/single.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var add = require("lodash").add'));
      assert.equal((await run(b)).bar, 3);
    });

    it('should support commonjs output with old node without destructuring (multiple)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-node/multiple.js'
        )
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
          '/integration/formats/commonjs-destructuring-browsers/single.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var add = require("lodash").add'));
    });

    it('should support commonjs output with old node without destructuring (multiple)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/commonjs-destructuring-browsers/multiple.js'
        )
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('exports.bar'));
      assert(dist.includes('var _temp = require("lodash")'));
      assert(dist.includes('var add = _temp.add'));
      assert(dist.includes('var subtract = _temp.subtract'));
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

    it('should support async imports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-async/index.js')
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8'
      );
      assert(
        /Promise\.resolve\(require\('' \+ '\.\/async\..+?\.js'\)\)/.test(index)
      );

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8'
      );
      assert(async.includes('exports.foo = '));
    });

    it('should support async split bundles', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/commonjs-split/index.js')
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8'
      );
      assert(
        /Promise\.resolve\(require\('' \+ '\.\/async1\..+?\.js'\)\)/.test(index)
      );
      assert(
        /Promise\.resolve\(require\('' \+ '\.\/async2\..+?\.js'\)\)/.test(index)
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
            b => b.name.startsWith('async1') && b.name !== sharedBundle.name
          ).filePath,
        'utf8'
      );
      assert(
        new RegExp(
          `var {\\s*(.|\\n)+\\s*} = require\\("\\.\\/${sharedBundle.name}"\\)`
        ).test(async1)
      );

      let async2 = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async2')).filePath,
        'utf8'
      );
      assert(
        new RegExp(
          `var {\\s*(.|\\n)+\\s*} = require\\("\\.\\/${sharedBundle.name}"\\)`
        ).test(async2)
      );
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

    it('should support esmodule output (re-export)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm/re-export.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('export { a, c }'));
      assert(!dist.includes('export default'));
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

    it('should rename imports that conflict with exports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-conflict/a.js')
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('import { foo as _foo } from "foo";'));
      assert(dist.includes('export const foo = _foo + 3;'));
    });

    it('should support async imports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-async/index.js')
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8'
      );
      assert(/import\('' \+ '\.\/async\..+?\.js'\)/.test(index));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8'
      );
      assert(async.includes('export const foo'));
    });

    it('should support async split bundles', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-split/index.js')
      );

      let index = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('index')).filePath,
        'utf8'
      );
      assert(/import\('' \+ '\.\/async1\..+?\.js'\)/.test(index));
      assert(/import\('' \+ '\.\/async2\..+?\.js'\)/.test(index));

      let sharedBundle = b
        .getBundles()
        .find(b => b.name.startsWith('async1') && !index.includes(b.name));
      let shared = await outputFS.readFile(sharedBundle.filePath, 'utf8');
      assert(shared.includes('export var $'));

      let async1 = await outputFS.readFile(
        b
          .getBundles()
          .find(
            b => b.name.startsWith('async1') && b.name !== sharedBundle.name
          ).filePath,
        'utf8'
      );
      assert(
        new RegExp(`import { .+ } from "\\.\\/${sharedBundle.name}"`).test(
          async1
        )
      );

      let async2 = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async2')).filePath,
        'utf8'
      );
      assert(
        new RegExp(`import { .+ } from "\\.\\/${sharedBundle.name}"`).test(
          async2
        )
      );
    });

    it('should support building esmodules for browser targets', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-browser/index.html')
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8'
      );

      assert(html.includes('<script type="module" src="/esm-browser'));

      let entry = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('esm-browser')).filePath,
        'utf8'
      );
      assert(entry.includes("import('' + './async"));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8'
      );
      assert(async.includes('export const foo'));
    });

    it('should support use an import polyfill for older browsers', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-browser/index.html'),
        {defaultEngines: null}
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8'
      );

      assert(html.includes('<script type="module" src="/esm-browser'));

      let entry = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('esm-browser')).filePath,
        'utf8'
      );
      assert(entry.includes('function importModule'));
      assert(entry.includes("('/async"));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async')).filePath,
        'utf8'
      );
      assert(async.includes('export const foo'));
    });

    it('should support building esmodules with css imports', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/formats/esm-browser-css/index.html')
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8'
      );

      assert(html.includes('<script type="module" src="/esm-browser-css'));
      assert(html.includes('<link rel="stylesheet" href="/esm-browser-css'));

      let entry = await outputFS.readFile(
        b
          .getBundles()
          .find(b => b.type === 'js' && b.name.startsWith('esm-browser-css'))
          .filePath,
        'utf8'
      );
      assert(entry.includes('Promise.all'));
      assert(/\('\/async\..+?\.css'\)/.test(entry));
      assert(/import\('' \+ '\.\/async\..+?\.js'\)/.test(entry));

      let async = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'js' && b.name.startsWith('async'))
          .filePath,
        'utf8'
      );
      assert(async.includes('export const foo'));
      assert(!async.includes('.css"'));
    });

    it('should support building esmodules with split bundles', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/formats/esm-browser-split-bundle/index.html'
        )
      );

      let html = await outputFS.readFile(
        b.getBundles().find(b => b.type === 'html').filePath,
        'utf8'
      );

      assert(
        html.includes('<script type="module" src="/esm-browser-split-bundle')
      );

      let entry = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('esm-browser-split-bundle'))
          .filePath,
        'utf8'
      );
      // async import both bundles in parallel for performance
      assert(
        /import\('' \+ '\.\/async1\..+?\.js'\), import\('' \+ '\.\/async1\..+?\.js'\)/.test(
          entry
        )
      );
      assert(
        /import\('' \+ '\.\/async1\..+?\.js'\), import\('' \+ '\.\/async2\..+?\.js'\)/.test(
          entry
        )
      );
      assert(!entry.includes('Promise.all')); // not needed - esmodules will wait for shared bundle

      let sharedName = entry.match(/import\('' \+ '\.\/(.+?)'\)/)[1];
      let shared = await outputFS.readFile(
        b.getBundles().find(b => b.name === sharedName).filePath,
        'utf8'
      );

      assert(shared.includes('export var $'));

      let async1 = await outputFS.readFile(
        b
          .getBundles()
          .find(b => b.name.startsWith('async1') && b.name !== sharedName)
          .filePath,
        'utf8'
      );
      assert(
        new RegExp(`import { .+ } from "\\.\\/${sharedName}"`).test(async1)
      );

      let async2 = await outputFS.readFile(
        b.getBundles().find(b => b.name.startsWith('async2')).filePath,
        'utf8'
      );
      assert(
        new RegExp(`import { .+ } from "\\.\\/${sharedName}"`).test(async2)
      );
    });
  });
});
