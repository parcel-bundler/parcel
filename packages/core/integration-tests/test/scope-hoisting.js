import assert from 'assert';
import path from 'path';
import {
  bundle as _bundle,
  bundler as _bundler,
  run,
  outputFS,
  overlayFS,
  assertBundles,
  getNextBuild,
} from '@parcel/test-utils';

const bundle = (name, opts = {}) =>
  _bundle(name, Object.assign({scopeHoist: true}, opts));

const bundler = (name, opts = {}) =>
  _bundler(name, Object.assign({scopeHoist: true}, opts));

describe('scope hoisting', function() {
  describe('es6', function() {
    it('supports default imports and exports of expressions', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/default-export-expression/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports default imports and exports of declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/default-export-declaration/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports default imports and exports of anonymous declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/default-export-anonymous/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports default imports and exports of variables', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/default-export-variable/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports named imports and exports of declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/named-export-declaration/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports named imports and exports of variables', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/named-export-variable/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports renaming superclass identifiers', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/rename-superclass/a.js',
        ),
      );
      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports renaming imports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/renamed-import/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports renaming exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/renamed-export/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports importing a namespace of exported values', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports re-exporting all exports from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-all/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 6);
    });

    it('supports re-exporting all exports from multiple modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-all-multiple/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 15);
    });

    it('supports importing all exports re-exported from multiple modules deep', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-multiple-wildcards/a.js',
        ),
      );

      let {foo, bar, baz, a, b: bb} = await run(b);
      assert.equal(foo + bar + baz + a + bb, 15);
    });

    it('supports re-exporting all exports from multiple modules deep', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-multiple/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 7);
    });

    it('supports re-exporting individual named exports from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-named/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting default exports from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-default/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting a namespace from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-namespace/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 6);
    });

    it('excludes default when re-exporting a module', async function() {
      let threw = false;
      try {
        await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/re-export-exclude-default/a.js',
          ),
        );
      } catch (err) {
        threw = true;
        assert(
          err.diagnostics[0].message.endsWith("b.js does not export 'default'"),
        );
      }

      assert(threw);
    });

    it('supports multiple exports of the same variable', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/multi-export/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 6);
    });

    it('supports live bindings of named exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/live-bindings/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 8);
    });

    it('supports dynamic import syntax for code splitting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/dynamic-import/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(await output.default, 5);
    });

    it('supports nested dynamic imports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/dynamic-import-dynamic/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(await output.default, 123);
    });

    it('should not export function arguments', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/export-binding-identifiers/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, ['test']);
    });

    it('throws a meaningful error on undefined exports', async function() {
      let threw = false;
      try {
        await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/export-undefined/a.js',
          ),
        );
      } catch (err) {
        threw = true;
        assert(
          err.diagnostics[0].message.includes(
            "Export 'Test' is not defined (1:8)",
          ),
        );
      }

      assert(threw);
    });

    it('supports import default CommonJS interop', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-default/a.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert.equal(
        dist.match(/var \$[a-z0-9]+\$\$interop\$default =/g).length,
        2,
      );

      let output = await run(b);
      assert.deepEqual(output, 'foobar:foo:bar');
    });

    it('does not export reassigned CommonJS exports references', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/commonjs-exports-reassign/a.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(/var \$[a-z0-9]+\$cjs_exports/.test(dist));

      let [foo, bExports] = await run(b);
      assert.equal(foo, 'foobar');
      assert.equal(typeof bExports, 'object');
    });

    it('supports import default CommonJS interop with dynamic imports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/dynamic-default-interop/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(await output, 6);
    });

    it('supports exporting an import', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-var/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foobar');
    });

    it('supports requiring a re-exported and renamed ES6 import', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-renamed/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foobar');
    });

    it('supports simultaneous import and re-export of a symbol', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-import/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 4 * 123);
    });

    it('supports optimizing away an unused ES6 re-export', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-re-exports/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 123);
    });

    it('should not optimize away an unused ES6 re-export and an used import', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-re-exports-import/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 123);
    });

    it('should handle sideEffects: false with namespace imports and re-exports correctly', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-re-exports-all/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 16);
    });

    it('supports correctly handles ES6 re-exports in library mode entries', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-re-exports-library/a.js',
        ),
      );

      let contents = await outputFS.readFile(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-re-exports-library/build.js',
        ),
        'utf8',
      );
      assert(!contents.includes('console.log'));

      let output = await run(b);
      assert.deepEqual(output, {c1: 'foo'});
    });

    it('correctly updates deferred assets that are reexported', async function() {
      let testDir = path.join(
        __dirname,
        '/integration/scope-hoisting/es6/side-effects-update-deferred-reexported',
      );

      let b = bundler(path.join(testDir, 'index.js'), {
        inputFS: overlayFS,
        outputFS: overlayFS,
      });

      let subscription = await b.watch();

      let bundleEvent = await getNextBuild(b);
      assert(bundleEvent.type === 'buildSuccess');
      let output = await run(bundleEvent.bundleGraph);
      assert.deepEqual(output, '12345hello');

      await overlayFS.mkdirp(path.join(testDir, 'node_modules', 'foo'));
      await overlayFS.copyFile(
        path.join(testDir, 'node_modules', 'foo', 'foo_updated.js'),
        path.join(testDir, 'node_modules', 'foo', 'foo.js'),
      );

      bundleEvent = await getNextBuild(b);
      assert(bundleEvent.type === 'buildSuccess');
      output = await run(bundleEvent.bundleGraph);
      assert.deepEqual(output, '1234556789');

      await subscription.unsubscribe();
    });

    it('correctly updates deferred assets that are reexported and imported directly', async function() {
      let testDir = path.join(
        __dirname,
        '/integration/scope-hoisting/es6/side-effects-update-deferred-direct',
      );

      let b = bundler(path.join(testDir, 'index.js'), {
        inputFS: overlayFS,
        outputFS: overlayFS,
      });

      let subscription = await b.watch();

      let bundleEvent = await getNextBuild(b);
      assert(bundleEvent.type === 'buildSuccess');
      let output = await run(bundleEvent.bundleGraph);
      assert.deepEqual(output, '12345hello');

      await overlayFS.mkdirp(path.join(testDir, 'node_modules', 'foo'));
      await overlayFS.copyFile(
        path.join(testDir, 'node_modules', 'foo', 'foo_updated.js'),
        path.join(testDir, 'node_modules', 'foo', 'foo.js'),
      );

      bundleEvent = await getNextBuild(b);
      assert(bundleEvent.type === 'buildSuccess');
      output = await run(bundleEvent.bundleGraph);
      assert.deepEqual(output, '1234556789');

      await subscription.unsubscribe();
    });

    it('removes deferred reexports when imported from multiple asssets', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-re-exports-multiple/a.js',
        ),
      );

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );

      assert(!contents.includes('$import$'));
      assert(contents.includes('= 1234;'));
      assert(!contents.includes('= 5678;'));

      // can't test dynamic imports in node
      // let output = await run(b);
      // assert.deepEqual(output, [1234, 1234]);
    });

    it('keeps side effects by default', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects/a.js',
        ),
      );

      let called = false;
      let output = await run(b, {
        sideEffect: () => {
          called = true;
        },
      });

      assert(called, 'side effect not called');
      assert.deepEqual(output, 4);
    });

    it('supports the package.json sideEffects: false flag', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-false/a.js',
        ),
      );

      let called = false;
      let output = await run(b, {
        sideEffect: () => {
          called = true;
        },
      });

      assert(!called, 'side effect called');
      assert.deepEqual(output, 4);
    });

    it('supports wildcards with sideEffects: false', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-false-wildcards/a.js',
        ),
      );
      let called = false;
      let output = await run(b, {
        sideEffect: () => {
          called = true;
        },
      });

      assert(!called, 'side effect called');
      assert.deepEqual(output, 'bar');
    });

    it('supports the package.json sideEffects flag with an array', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-array/a.js',
        ),
      );

      let calls = [];
      let output = await run(b, {
        sideEffect: caller => {
          calls.push(caller);
        },
      });

      assert(calls.toString() == 'foo', "side effect called for 'foo'");
      assert.deepEqual(output, 4);
    });

    it('supports the package.json sideEffects: false flag with shared dependencies', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-false-duplicate/a.js',
        ),
      );

      let called = false;
      let output = await run(b, {
        sideEffect: () => {
          called = true;
        },
      });

      assert(!called, 'side effect called');
      assert.deepEqual(output, 6);
    });

    it('supports the package.json sideEffects: false flag with shared dependencies', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-split/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(await output, 581);
    });

    it('missing exports should be replaced with an empty object', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/empty-module/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {b: {}});
    });

    it('supports importing a namespace from a commonjs module when code split', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-commonjs/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(await output, 4);
    });

    it('supports importing a namespace from a wrapped module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-wrapped/a.js',
        ),
      );

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('$parcel$exportWildcard'));

      let output = await run(b);
      assert.deepEqual(await output, 1);
    });

    it('removes unused exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 2);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('foo'));
      assert(!contents.includes('bar'));
    });

    it('removes unused function exports when minified', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking-functions/a.js',
        ),
        {minify: true},
      );

      let output = await run(b);
      assert.deepEqual(output, 9);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(/output=9/.test(contents));
      assert(!/.-./.test(contents));
    });

    it('removes unused transpiled classes using terser when minified', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking-classes-babel/a.js',
        ),
        {minify: true},
      );

      let output = await run(b);
      assert.deepEqual(output, 3);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('method'));
    });

    it('keeps member expression with computed properties that are variables', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking-export-computed-prop/a.js',
        ),
        {minify: true},
      );

      let output = await run(b);
      assert.strictEqual(output[0], true);
      assert.strictEqual(typeof output[1], 'undefined');
      assert.strictEqual(output[2], true);
      assert.strictEqual(typeof output[3], 'undefined');
    });

    it('support exporting a ES6 module exported as CommonJS', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-commonjs/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foo');
    });

    it('should support named imports on wrapped modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-wrapped/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'bar');
    });

    it('should support the jsx pragma', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/scope-hoisting/es6/jsx-pragma/a.js'),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        children: 'Test',
        props: null,
        type: 'span',
      });
    });

    it('should not nameclash with internal variables', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/scope-hoisting/es6/name-clash/a.js'),
      );

      let output = await run(b);
      assert.deepEqual(output, 'bar');
    });

    it('should shake pure property assignments', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/pure-assignment/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 2);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(!/bar/.test(contents));
      assert(!/displayName/.test(contents));
    });

    it('should correctly rename references to default exported classes', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/default-export-class-rename/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output.foo, 'bar');
    });

    it('should correctly rename references to a class in the class body', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/class-selfreference/a.js',
        ),
      );
      let output = await run(b);
      assert.deepEqual(output.foo, 'bar');
    });
  });

  describe('commonjs', function() {
    it('supports require of commonjs modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('concats commonjs modules in the correct order', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/concat-order/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports default imports of commonjs modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/default-import/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('concats modules with inserted globals in the correct order', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/concat-order-globals/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'foobar');
    });

    it('supports named imports of commonjs modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/named-import/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports namespace imports of commonjs modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/import-namespace/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 default export of expressions', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-default-export-expression/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 default export of declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-default-export-declaration/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 default export of variables', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-default-export-variable/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 named export of declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-named-export-declaration/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 named export of variables', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-named-export-variable/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 renamed exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-renamed-export/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports require of es6 module re-exporting all exports from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-re-export-all/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 6);
    });

    it('supports require of es6 module re-exporting all exports from multiple modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-re-export-multiple/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 7);
    });

    it('supports re-exporting individual named exports from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-re-export-named/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting default exports from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-re-export-default/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 3);
    });

    it('supports re-exporting a namespace from another module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-re-export-namespace/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 6);
    });

    it('excludes default when re-exporting a module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-re-export-exclude-default/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {foo: 3});
    });

    it('supports hybrid ES6 + commonjs modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/es6-commonjs-hybrid/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('inserts commonjs exports object in the right place', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/export-order/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out exports access resolving if it is accessed freely (exports assign)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/exports-assign.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out exports access resolving if it is accessed freely (exports define)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/exports-define.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out exports access resolving if it is accessed freely (module.exports assign)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/module-exports-assign.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out exports access resolving if it is accessed freely (module.exports define)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/module-exports-define.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('builds commonjs modules that assigns to exports before module.exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-before-module-exports/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 42);
    });

    it('builds commonjs modules that assigns to module.exports before exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/module-exports-before-exports/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 42);
    });

    it("doesn't insert parcelRequire for missing non-js assets", async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/missing-non-js/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 27);
    });

    it('define exports in the outermost scope', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/define-exports/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'bar');
    });

    it('supports live bindings of named exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/live-bindings/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 8);
    });

    it('should wrap modules that use eval in a function', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-eval/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 4);
    });

    it('should wrap modules that have a top-level return', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-return/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('should wrap modules that access `module` as a free variable', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-module/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {exports: {foo: 2}});
    });

    it('should call init for wrapped modules when codesplitting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-module-codesplit/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 2);
    });

    it('should wrap modules that non-statically access `module`', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-module-computed/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {foo: 2});
    });

    it('should not rename function local variables according to global replacements', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/keep-local-function-var/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foo');
    });

    it('supports assigning to this as exports object', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/this-reference/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('supports assigning to this as exports object in wrapped module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/this-reference-wrapped/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 6);
    });

    it('supports module object properties', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/module-object/a.js',
        ),
      );

      let entryBundle;
      b.traverseBundles((bundle, ctx, traversal) => {
        if (bundle.isEntry) {
          entryBundle = bundle;
          traversal.stop();
        }
      });
      let entryAsset = entryBundle.getMainEntry();

      // TODO: this test doesn't currently work in older browsers since babel
      // replaces the typeof calls before we can get to them.
      let output = await run(b);
      assert.equal(output.id, entryAsset.id);
      assert.equal(output.hot, null);
      assert.equal(output.moduleRequire, null);
      assert.equal(output.type, 'object');
      assert.deepEqual(output.exports, {});
      assert.equal(output.exportsType, 'object');
      assert.equal(output.require, 'function');
    });

    it("doesn't support require.resolve calls", async function() {
      await assert.rejects(
        () =>
          bundle(
            path.join(
              __dirname,
              '/integration/scope-hoisting/commonjs/require-resolve/a.js',
            ),
          ),
        {
          message:
            "`require.resolve` calls for bundled modules or bundled assets aren't supported with scope hoisting",
        },
      );
    });

    it('supports require.resolve calls for excluded modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-resolve-excluded/a.js',
        ),
      );

      let output = await run(b, {
        require: {
          resolve: () => 'my-resolved-fs',
        },
      });
      assert.deepEqual(output, 'my-resolved-fs');
    });

    it('supports requiring a re-exported ES6 import', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/re-export-var/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foobar');
    });

    it('supports object pattern requires', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/object-pattern/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 5);
    });

    it('eliminates CommonJS export object where possible', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/eliminate-exports/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 6);
    });

    it('supports multiple assignments in one line', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/multi-assign/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {foo: 2, bar: 2, baz: 2});
    });

    it('supports circular dependencies', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-circular/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'foo bar');
    });

    it('executes modules in the correct order', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-execution-order/a.js',
        ),
      );

      let out = [];
      await run(b, {
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'b', 'c', 'd']);
    });

    it('supports conditional requires', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-conditional/a.js',
        ),
      );

      let out = [];
      await run(b, {
        b: false,
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'd']);

      out = [];
      await run(b, {
        b: true,
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'b', 'c', 'd']);
    });

    it('supports requires inside functions', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-in-function/a.js',
        ),
      );

      let out = [];
      await run(b, {
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'c', 'b']);
    });

    it('supports requires inside functions with es6 import side effects', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-in-function-import/a.js',
        ),
      );

      let out = [];
      await run(b, {
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'd', 'c', 'b']);
    });

    it('hoists import calls to the top', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-in-function-import-hoist/a.js',
        ),
      );

      let out = [];
      await run(b, {
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'd', 'c', 'b']);
    });

    it('supports requires inside functions with es6 re-export side effects', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-in-function-reexport/a.js',
        ),
      );

      let out = [];
      await run(b, {
        output(o) {
          out.push(o);
        },
      });

      assert.deepEqual(out, ['a', 'd', 'c', 'b']);
    });

    it('can bundle the node stream module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/stream-module/a.js',
        ),
      );

      let res = await run(b);
      assert.equal(typeof res.Readable, 'function');
      assert.equal(typeof res.Writable, 'function');
      assert.equal(typeof res.Duplex, 'function');
    });

    it('missing exports should be replaced with an empty object', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/empty-module/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {b: {}});
    });

    it('removes unused exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/tree-shaking/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 2);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('foo'));
      assert(!contents.includes('bar'));
    });

    it('supports removing an unused inline export with uglify minification', async function() {
      // Uglify does strange things to multiple assignments in a line.
      // See https://github.com/parcel-bundler/parcel/issues/1549
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/export-local/a.js',
        ),
        {minify: true},
      );

      let output = await run(b);
      assert.deepEqual(output, 3);
    });

    it('should support sideEffects: false', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/side-effects-false/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 9);
    });

    it('should support two aliases to the same module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-aliases/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 42);
    });

    it('should support optional requires', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-optional/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 42);
    });

    it('should insert __esModule interop flag when importing from an ES module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/interop-require-es-module/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output.__esModule, true);
      assert.equal(output.default, 2);
    });

    it('should export the same values for interop shared modules in main and child bundle', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/interop-require-es-module-code-split/main.js',
        ),
      );

      let output = await run(b);
      assert.equal(await output.default, 'bar:bar');
    });

    it('should export the same values for interop shared modules in main and child bundle if shared bundle is deep nested', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/interop-require-es-module-code-split-intermediate/main.js',
        ),
      );

      let output = await run(b);
      assert.equal(await output.default, 'bar:bar');
    });

    it('should support assigning to exports from inside a function', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/export-assign-scope/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 2);
    });

    it('should also hoist inserted polyfills of globals', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/globals-polyfills/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, true);
    });

    it('should support wrapping array destructuring declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-destructuring-array/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [1, 2]);
    });

    it('should support wrapping object destructuring declarations', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-destructuring-object/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [4, 2]);
    });
  });

  it('should not throw with JS included from HTML', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-js/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    let value = null;
    await run(b, {
      alert: v => (value = v),
    });
    assert.equal(value, 'Hi');
  });

  it('should not throw with JS dynamic imports included from HTML', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-js-dynamic/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: [
          'bundle-url.js',
          'cacheLoader.js',
          'index.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        type: 'js',
        assets: ['local.js'],
      },
    ]);

    let output = (await run(b)).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 'Imported: foobar');
  });

  it('should include the prelude in shared entry bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-shared/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['index.js'],
      },
      {
        name: 'iframe.html',
        assets: ['iframe.html'],
      },
      {
        type: 'js',
        assets: ['iframe.js'],
      },
      {
        type: 'js',
        assets: ['lodash.js'],
      },
    ]);

    let sharedBundle = b
      .getBundles()
      .sort((a, b) => b.stats.size - a.stats.size)[0];
    let contents = await outputFS.readFile(sharedBundle.filePath, 'utf8');
    assert(contents.includes(`parcelRequire =`));

    let mainBundle = b
      .getBundles()
      .find(b => b.type === 'js' && b.name.startsWith('html-shared'));
    contents = await outputFS.readFile(mainBundle.filePath, 'utf8');
    assert(contents.includes(`parcelRequire =`));
  });

  it('does not include prelude if child bundles are isolated', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
    );

    let mainBundle = b.getBundles().find(b => b.name === 'index.js');
    let contents = await outputFS.readFile(mainBundle.filePath, 'utf8');
    assert(!contents.includes(`parcelRequire =`));
  });

  it('should include prelude in shared worker bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
    );

    let sharedBundle = b
      .getBundles()
      .sort((a, b) => b.stats.size - a.stats.size)
      .find(b => b.name !== 'index.js');
    let contents = await outputFS.readFile(sharedBundle.filePath, 'utf8');
    assert(contents.includes(`parcelRequire =`));

    let workerBundle = b.getBundles().find(b => b.name.startsWith('worker-b'));
    contents = await outputFS.readFile(workerBundle.filePath, 'utf8');
    assert(contents.includes(`importScripts("./${sharedBundle.name}")`));
  });

  // Mirrors the equivalent test in javascript.js
  it('should insert global variables when needed', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals/scope-hoisting.js'),
    );

    let output = await run(b);
    assert.deepEqual(output(), {
      dir: path.join(__dirname, '/integration/globals'),
      file: path.join(__dirname, '/integration/globals/index.js'),
      buf: Buffer.from('browser').toString('base64'),
      global: true,
    });
  });
});
