import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {normalizePath} from '@parcel/utils';
import {md} from '@parcel/diagnostic';
import {
  assertBundles,
  assertDependencyWasDeferred,
  bundle as _bundle,
  bundler as _bundler,
  distDir,
  findAsset,
  findDependency,
  getNextBuild,
  mergeParcelOptions,
  outputFS,
  overlayFS,
  run,
  runBundle,
} from '@parcel/test-utils';

const bundle = (name, opts = {}) => {
  return _bundle(
    name,
    // $FlowFixMe
    mergeParcelOptions(
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
      opts,
    ),
  );
};

const bundler = (name, opts = {}) => {
  return _bundler(
    name,
    // $FlowFixMe
    mergeParcelOptions(
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
      opts,
    ),
  );
};

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

    it('supports renaming non-ASCII identifiers', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/non-ascii-identifiers/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [1, 2, 3, 4]);
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

    it('supports importing from a reexporting asset in an anchestor (1)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/ancestor-reexport/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, ['index', 'async']);
    });

    it('supports importing from a reexporting asset in an anchestor (2)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/ancestor-reexport2/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [123, 123]);
    });

    it('supports importing from a reexporting asset in an anchestor (3)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/ancestor-reexport2/b.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [123, 123]);
    });

    it('supports async import of internalized asset with unused return value', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/async-internalize-unused/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output, 'bc');
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

    it('supports namespace imports of excluded assets (node_modules)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-external/a.js',
        ),
      );

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );

      assert(contents.includes('require("lodash")'));

      let output = await run(b);
      assert.deepEqual(output.default, 12);
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

    it('supports re-exporting all exports from an external module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-all-external/a.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['a.js', 'b.js'],
        },
      ]);

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'b.js', 'lodash'))),
        new Set(['add']),
      );

      // getSymbolResolution is broken
      // let output = await run(b);
      // assert.equal(output, 3);
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

    it('can import from a different bundle via a re-export (1)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-bundle-boundary/index.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, ['operational', 'ui']);
    });

    it('can import from a different bundle via a re-export (2)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-bundle-boundary2/index.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, ['foo', 'foo']);
    });

    it('can import from its own bundle with a split package', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-bundle-boundary3/index.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [['a', 'b'], 'themed']);
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

    it('supports re-exporting a namespace from another module (chained)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-namespace-chained/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        Bar: {
          A: 1,
          B: 2,
        },
        Foo: {
          A: 1,
          B: 2,
        },
      });
    });

    it('has the correct order with namespace re-exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-namespace-order/index.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, Symbol.for('abc'));
    });

    it('excludes default when re-exporting a module', async function() {
      let source = path.normalize(
        'integration/scope-hoisting/es6/re-export-exclude-default/a.js',
      );
      let message = md`${normalizePath(
        'integration/scope-hoisting/es6/re-export-exclude-default/b.js',
        false,
      )} does not export 'default'`;
      await assert.rejects(() => bundle(path.join(__dirname, source)), {
        name: 'BuildError',
        message,
        diagnostics: [
          {
            message,
            origin: '@parcel/core',
            codeFrames: [
              {
                filePath: path.join(__dirname, source),
                language: 'js',
                codeHighlights: [
                  {
                    start: {
                      line: 1,
                      column: 8,
                    },
                    end: {
                      line: 1,
                      column: 8,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it('throws when reexporting a missing symbol', async function() {
      let source = path.normalize(
        'integration/scope-hoisting/es6/re-export-missing/a.js',
      );
      let message = md`${normalizePath(
        'integration/scope-hoisting/es6/re-export-missing/c.js',
        false,
      )} does not export 'foo'`;
      await assert.rejects(() => bundle(path.join(__dirname, source)), {
        name: 'BuildError',
        message,
        diagnostics: [
          {
            message,
            origin: '@parcel/core',
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  'integration/scope-hoisting/es6/re-export-missing/b.js',
                ),
                language: 'js',
                codeHighlights: [
                  {
                    start: {
                      line: 1,
                      column: 9,
                    },
                    end: {
                      line: 1,
                      column: 11,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
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

    it('supports live bindings in namespaces of reexporting assets', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/live-bindings-reexports-namespace/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [1, 2]);
    });

    it('supports live bindings across bundles', async function() {
      let b = await bundle(
        ['a.html', 'b.html'].map(f =>
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/live-bindings-cross-bundle',
            f,
          ),
        ),
        {mode: 'production'},
      );

      let ctx = await runBundle(
        b,
        b.getBundles().find(b => b.type === 'html'),
        {output: null},
        {require: false},
      );
      assert.deepEqual(ctx.output, 'aaa');
    });

    it('supports live bindings of default exports', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5658
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/export-default-live/a.js',
        ),
      );

      let out = [];
      await run(b, {
        output(o) {
          out.push(o);
        },
      });
      assert.deepEqual(out, [5, 10]);
    });

    it('supports dynamic import syntax for code splitting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/dynamic-import/a.js',
        ),
      );

      assert.equal(await run(b), 5);
    });

    it('supports nested dynamic imports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/dynamic-import-dynamic/a.js',
        ),
      );

      assert.equal(await run(b), 123);
    });

    it('supports named exports before the variable declaration', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/export-before-declaration/a.js',
        ),
      );

      assert.deepEqual(await run(b), {x: 2});
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

    it('should default export globals', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/export-default-global/a.js',
        ),
      );

      let Test = Symbol('Test');

      let output = await run(b, {Test});
      assert.strictEqual(output, Test);
    });

    it('should default export JS globals', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/export-default-js-global/a.js',
        ),
      );

      let output = await run(b);
      assert(new output([1, 2, 3]).has(1));
    });

    it('should remove export named declaration without specifiers', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/export-named-empty/a.js',
        ),
      );

      let content = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(!/export\s*{\s*}\s*;/.test(content));

      let output = await run(b);
      assert.strictEqual(output, 2);
    });

    it.skip('throws a meaningful error on undefined exports', async function() {
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

    it('supports importing named CommonJS (export individual)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-export-individual/a.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'c.js')))),
        new Set(['name', 'version']),
      );

      let output = await run(b);
      assert.deepEqual(output, 'name:1.2.3');
    });

    it('supports importing named CommonJS (export namespace)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-export-object/a.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'c.js')))),
        new Set(['name', 'version']),
      );

      let output = await run(b);
      assert.deepEqual(output, 'name:1.2.3');
    });

    it('supports default importing CommonJS (export namespace)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-export-object-default/a.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(nullthrows(findAsset(b, 'b1.js')).symbols.exportSymbols()),
        new Set(['*']),
      );

      assert.deepStrictEqual(
        new Set(nullthrows(findAsset(b, 'b2.js')).symbols.exportSymbols()),
        new Set(['*']),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        x: {foo: 1, default: 2},
        y: 4,
      });
    });

    it('supports import default CommonJS interop (export value)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-default/a.js',
        ),
      );

      let dist = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(dist.includes('$parcel$interopDefault'));

      let output = await run(b);
      assert.deepEqual(output, 'foobar:foo:bar');
    });

    it('supports import default CommonJS interop (individual exports)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-export-individual-default/a.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(nullthrows(findAsset(b, 'b1.js')).symbols.exportSymbols()),
        new Set(['*', 'default', 'foo']),
      );

      assert.deepStrictEqual(
        new Set(nullthrows(findAsset(b, 'b2.js')).symbols.exportSymbols()),
        new Set(['*', 'foo', 'default', '__esModule']),
      );

      assert.deepStrictEqual(
        new Set(nullthrows(findAsset(b, 'b3.js')).symbols.exportSymbols()),
        new Set(['*']),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        x: {foo: 1, default: 2},
        y: 4,
        z: 6,
      });
    });

    it('falls back when importing missing symbols from CJS', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-commonjs-missing/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output, undefined);
    });

    it('does not export reassigned CommonJS exports references', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/commonjs-exports-reassign/a.js',
        ),
      );

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

      assert.deepEqual(await run(b), 6);
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

    it('supports importing from a wrapped asset', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-wrapped/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, ['a', true]);
    });

    it('supports importing from a wrapped asset with multiple bailouts', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-wrapped-bailout/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, ['b', true]);
    });

    it("unused and missing pseudo re-exports doen't fail the build", async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-pseudo/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foo');
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

    it('supports requiring a re-exported and renamed ES6 namespace import', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-renamed-namespace/a.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'a.js', './b.js'))),
        new Set(['default', 'x']),
      );

      let output = await run(b);
      assert.deepEqual(output, [123, 123]);
    });

    it('supports reexporting an asset from a shared bundle inside a shared bundle', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/shared-bundle-reexport/*.html',
        ),
        {mode: 'production'},
      );

      assertBundles(b, [
        {
          type: 'html',
          assets: ['index1.html'],
        },
        {
          type: 'js',
          assets: ['index1.js'],
        },
        {
          type: 'html',
          assets: ['index2.html'],
        },
        {
          type: 'js',
          assets: ['index2.js'],
        },
        {
          type: 'html',
          assets: ['index3.html'],
        },
        {
          type: 'js',
          assets: ['index3.js'],
        },
        {
          type: 'js',
          assets: ['a.js'],
        },
        {
          type: 'js',
          assets: ['b.js'],
        },
      ]);

      for (let bundle of b.getBundles().filter(b => b.type === 'html')) {
        let calls = [];
        await runBundle(b, bundle, {
          call(v) {
            calls.push(v);
          },
        });
        assert.equal(calls.length, 1);
        assert(calls[0].startsWith('abcabc'));
      }
    });

    it('supports simultaneous import and re-export of a symbol', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-import/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 5 * 123);

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'e.js')))),
        new Set(['default']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'e2.js')))),
        new Set(['default']),
      );
    });

    it('supports importing a namespace from a commonjs module when code split', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-commonjs/a.js',
        ),
      );

      assert.deepEqual(await run(b), 4);
    });

    it('supports resolving a static member access on a namespace', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-static-member/a.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(
          b.getUsedSymbols(findDependency(b, 'a.js', './library/index.js')),
        ),
        new Set(['foo', 'foobar']),
      );

      let calls = [];
      let output = await run(b, {
        sideEffect: v => {
          calls.push(v);
        },
      });
      assert.deepEqual(output, 'foofoobar');
      assert.deepEqual(calls, ['c1', 'c3']);
    });

    it('should bailout with a non-static member access on a namespace', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-static-member/b.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(
          b.getUsedSymbols(findDependency(b, 'b.js', './library/index.js')),
        ),
        new Set(['*']),
      );

      let calls = [];
      let output = await run(b, {
        sideEffect: v => {
          calls.push(v);
        },
      });
      assert.deepEqual(output, 'foo');
      assert.deepEqual(calls, ['c1', 'c2', 'c3']);
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
      assert.deepEqual(output, 1);
    });

    it('supports importing a namespace from a transpiled CommonJS module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-namespace-commonjs-transpiled/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        bar: 3,
        foo: 1,
      });
    });

    it('removes unused exports', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking/a.js',
        ),
        {mode: 'production'},
      );

      let output = await run(b);
      assert.deepEqual(output, 2);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('output=2'));
      assert(!contents.includes('bar'));
    });

    it('removes unused function exports when minified', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking-functions/a.js',
        ),
        {
          defaultTargetOptions: {
            shouldOptimize: true,
          },
        },
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
        {
          defaultTargetOptions: {
            shouldOptimize: true,
          },
        },
      );

      let output = await run(b);
      assert.deepEqual(output, 3);

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('method'));
    });

    ['global', 'esmodule'].forEach(outputFormat => {
      let targets = {
        default: {
          outputFormat,
          distDir,
        },
      };

      describe('cross bundle tree shaking: ' + outputFormat, () => {
        it('removes unused exports across bundles', async () => {
          let b = await bundle(
            path.join(
              __dirname,
              '/integration/scope-hoisting/es6/tree-shaking-cross-bundle/a.js',
            ),
            {targets, mode: 'production'},
          );

          if (outputFormat != 'esmodule') {
            // TODO execute ESM at some point
            assert.deepEqual(await run(b), ['b1:foo', 'b2:foo']);
          }

          let contents = await outputFS.readFile(
            b.getBundles().find(b => b.name.startsWith('b1')).filePath,
            'utf8',
          );
          assert(!contents.includes('bar'));

          contents = await outputFS.readFile(
            b.getBundles().find(b => b.name.startsWith('b2')).filePath,
            'utf8',
          );
          assert(!contents.includes('bar'));
        });

        it('removes unused exports with re-exports across bundles', async () => {
          let b = await bundle(
            path.join(
              __dirname,
              '/integration/scope-hoisting/es6/tree-shaking-cross-bundle-re-export/a.js',
            ),
            {targets, mode: 'production'},
          );

          if (outputFormat != 'esmodule') {
            // TODO execute ESM at some point
            assert.deepEqual(await run(b), ['b1:foo', 'b2:foo']);
          }

          let contents = await outputFS.readFile(
            b.getBundles().find(b => b.name.startsWith('b1')).filePath,
            'utf8',
          );
          assert(!contents.includes('bar'));

          contents = await outputFS.readFile(
            b.getBundles().find(b => b.name.startsWith('b2')).filePath,
            'utf8',
          );
          assert(!contents.includes('bar'));
        });

        it('removes unused exports with wildcard re-exports across bundles', async () => {
          let b = await bundle(
            path.join(
              __dirname,
              '/integration/scope-hoisting/es6/tree-shaking-cross-bundle-re-export-wildcard/a.js',
            ),
            {targets, mode: 'production'},
          );

          if (outputFormat != 'esmodule') {
            // TODO execute ESM at some point
            assert.deepEqual(await run(b), ['b1:foo', 'b2:foo']);
          }

          let contents = await outputFS.readFile(
            b.getBundles().find(b => b.name.startsWith('b1')).filePath,
            'utf8',
          );
          assert(!contents.includes('bar'));

          contents = await outputFS.readFile(
            b.getBundles().find(b => b.name.startsWith('b2')).filePath,
            'utf8',
          );
          assert(!contents.includes('bar'));
        });
      });
    });

    describe('tree shaking dynamic imports', function() {
      it.skip('supports tree shaking statically analyzable dynamic import: destructued await assignment', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/await-assignment.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, ['foo', 'thing']);

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(b, 'await-assignment.js', './async.js'),
            ),
          ),
          new Set(['foo', 'thing']),
        );
        assert(b.isDependencySkipped(findDependency(b, 'async.js', './a1.js')));

        let contents = await outputFS.readFile(
          b
            .getBundles()
            .find(b => b.getMainEntry().filePath.endsWith('async.js')).filePath,
          'utf8',
        );
        assert(!contents.includes('bar'));
        assert(!contents.includes('stuff'));
      });

      it('supports tree shaking statically analyzable dynamic import: destructured await declaration', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/await-declaration.js',
          ),
          {mode: 'production'},
        );

        let output = await run(b);
        assert.deepEqual(output, ['foo', 'thing']);

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(b, 'await-declaration.js', './async.js'),
            ),
          ),
          new Set(['foo', 'thing']),
        );
        assert(b.isDependencySkipped(findDependency(b, 'async.js', './a1.js')));

        let contents = await outputFS.readFile(
          b
            .getBundles()
            .find(b => b.getMainEntry().filePath.endsWith('async.js')).filePath,
          'utf8',
        );
        assert(!contents.includes('bar'));
        assert(!contents.includes('stuff'));
      });

      it('supports tree shaking statically analyzable dynamic import: namespace await declaration', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/await-declaration-namespace.js',
          ),
          {mode: 'production'},
        );

        let output = await run(b);
        assert.deepEqual(output, ['foo', 'thing']);

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(b, 'await-declaration-namespace.js', './async.js'),
            ),
          ),
          new Set(['foo', 'thing']),
        );
        assert(b.isDependencySkipped(findDependency(b, 'async.js', './a1.js')));

        let contents = await outputFS.readFile(
          b
            .getBundles()
            .find(b => b.getMainEntry().filePath.endsWith('async.js')).filePath,
          'utf8',
        );
        assert(!contents.includes('bar'));
        assert(!contents.includes('stuff'));
      });

      it('supports tree shaking statically analyzable dynamic import: namespace await declaration bailout', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/await-declaration-namespace-bailout.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, {
          bar: 'bar',
          foo: 'foo',
          other: 'other',
          stuff: 'stuff',
          thing: 'thing',
        });

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(
                b,
                'await-declaration-namespace-bailout.js',
                './async.js',
              ),
            ),
          ),
          new Set(['*']),
        );
      });

      it('supports tree shaking statically analyzable dynamic import: namespace await declaration eval bailout', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/await-declaration-namespace-bailout-eval.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, 'thing');

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(
                b,
                'await-declaration-namespace-bailout-eval.js',
                './async.js',
              ),
            ),
          ),
          new Set(['*']),
        );
      });

      it('supports tree shaking statically analyzable dynamic import: destructured then', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/then.js',
          ),
          {mode: 'production'},
        );

        let output = await run(b);
        assert.deepEqual(output, ['foo', 'thing']);

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(findDependency(b, 'then.js', './async.js'))),
          new Set(['foo', 'thing']),
        );
        assert(b.isDependencySkipped(findDependency(b, 'async.js', './a1.js')));

        let contents = await outputFS.readFile(
          b
            .getBundles()
            .find(b => b.getMainEntry().filePath.endsWith('async.js')).filePath,
          'utf8',
        );
        assert(!contents.includes('bar'));
        assert(!contents.includes('stuff'));
      });

      it('supports tree shaking statically analyzable dynamic import: namespace then', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/then-namespace.js',
          ),
          {mode: 'production'},
        );

        let output = await run(b);
        assert.deepEqual(output, ['foo', 'thing']);

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(b, 'then-namespace.js', './async.js'),
            ),
          ),
          new Set(['foo', 'thing']),
        );
        assert(b.isDependencySkipped(findDependency(b, 'async.js', './a1.js')));

        let contents = await outputFS.readFile(
          b
            .getBundles()
            .find(b => b.getMainEntry().filePath.endsWith('async.js')).filePath,
          'utf8',
        );
        assert(!contents.includes('bar'));
        assert(!contents.includes('stuff'));
      });

      it('supports tree shaking statically analyzable dynamic import: namespace then bailout', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/then-namespace-bailout.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, {
          bar: 'bar',
          foo: 'foo',
          other: 'other',
          stuff: 'stuff',
          thing: 'thing',
        });

        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(
              findDependency(b, 'then-namespace-bailout.js', './async.js'),
            ),
          ),
          new Set(['*']),
        );
      });

      it('supports tree shaking statically analyzable dynamic import: esmodule output', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-dynamic-import/then.js',
          ),
          {
            mode: 'production',
            targets: {
              default: {
                outputFormat: 'esmodule',
                distDir,
              },
            },
          },
        );

        // let output = await run(b);
        // assert.deepEqual(output, 'foo');

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(findDependency(b, 'then.js', './async.js'))),
          new Set(['foo', 'thing']),
        );
        assert(b.isDependencySkipped(findDependency(b, 'async.js', './a1.js')));

        let contents = await outputFS.readFile(
          b
            .getBundles()
            .find(b => b.getMainEntry().filePath.endsWith('async.js')).filePath,
          'utf8',
        );
        assert(!contents.includes('bar'));
        assert(!contents.includes('stuff'));
      });

      it.skip('throws an error for missing exports for dynamic import: destructured await assignment', async function() {
        let source = 'await-assignment-error.js';
        let message = `async.js does not export 'missing'`;
        await assert.rejects(
          () =>
            bundle(
              path.join(
                __dirname,
                'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
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
                codeFrames: [
                  {
                    filePath: source,
                    language: 'js',
                    codeHighlights: [
                      {
                        start: {
                          column: 5,
                          line: 3,
                        },
                        end: {
                          column: 11,
                          line: 3,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        );
      });

      it('throws an error for missing exports for dynamic import: destructured await declaration', async function() {
        let source = path.join(
          __dirname,
          'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
          'await-declaration-error.js',
        );
        let message = `async.js does not export 'missing'`;
        await assert.rejects(
          () =>
            bundle(
              path.join(
                __dirname,
                'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
                'await-declaration-error.js',
              ),
            ),
          {
            name: 'BuildError',
            message,
            diagnostics: [
              {
                message,
                origin: '@parcel/core',
                codeFrames: [
                  {
                    filePath: source,
                    language: 'js',
                    codeHighlights: [
                      {
                        start: {
                          column: 8,
                          line: 2,
                        },
                        end: {
                          column: 14,
                          line: 2,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        );
      });

      it('throws an error for missing exports for dynamic import: namespace await declaration', async function() {
        let source = path.join(
          __dirname,
          'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
          'await-declaration-namespace-error.js',
        );
        let message = `async.js does not export 'missing'`;
        await assert.rejects(
          () =>
            bundle(
              path.join(
                __dirname,
                'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
                'await-declaration-namespace-error.js',
              ),
            ),
          {
            name: 'BuildError',
            message,
            diagnostics: [
              {
                message,
                origin: '@parcel/core',
                codeFrames: [
                  {
                    filePath: source,
                    language: 'js',
                    codeHighlights: [
                      {
                        start: {
                          column: 10,
                          line: 3,
                        },
                        end: {
                          column: 19,
                          line: 3,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        );
      });

      it('throws an error for missing exports for dynamic import: destructured then', async function() {
        let source = path.join(
          __dirname,
          'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
          'then-error.js',
        );
        let message = `async.js does not export 'missing'`;
        await assert.rejects(
          () =>
            bundle(
              path.join(
                __dirname,
                'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
                'then-error.js',
              ),
            ),
          {
            name: 'BuildError',
            message,
            diagnostics: [
              {
                message,
                origin: '@parcel/core',
                codeFrames: [
                  {
                    filePath: source,
                    language: 'js',
                    codeHighlights: [
                      {
                        start: {
                          column: 38,
                          line: 1,
                        },
                        end: {
                          column: 44,
                          line: 1,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        );
      });

      it('throws an error for missing exports for dynamic import: namespace then', async function() {
        let source = path.join(
          __dirname,
          'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
          'then-namespace-error.js',
        );
        let message = `async.js does not export 'missing'`;
        await assert.rejects(
          () =>
            bundle(
              path.join(
                __dirname,
                'integration/scope-hoisting/es6/tree-shaking-dynamic-import',
                'then-namespace-error.js',
              ),
            ),
          {
            name: 'BuildError',
            message,
            diagnostics: [
              {
                message,
                origin: '@parcel/core',
                codeFrames: [
                  {
                    filePath: source,
                    language: 'js',
                    codeHighlights: [
                      {
                        start: {
                          column: 45,
                          line: 1,
                        },
                        end: {
                          column: 54,
                          line: 1,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        );
      });
    });

    it('keeps member expression with computed properties that are variables', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking-export-computed-prop/a.js',
        ),
        {
          defaultTargetOptions: {
            shouldOptimize: true,
          },
        },
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

    it('concatenates in the correct order when re-exporting assets were excluded', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-false-order/index.js',
        ),
      );

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert(/\s+class\s+/.test(contents));

      let called = false;
      let output = await run(b, {
        sideEffect: () => {
          called = true;
        },
      });

      assert(!called, 'side effect called');
      assert.strictEqual(output[0], 'a');
      assert.strictEqual(output[1], 'b');
      assert(new output[3]() instanceof output[2]);
    });

    it('support chained namespace reexports of CommonJS', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/re-export-commonjs-wildcard/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, 'foo');
    });

    it('should support assets importing themselves', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-self/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output, 4);
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

    it('should support unused imports of wrapped modules in different bundles', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/import-wrapped-bundle-unused/a.js',
        ),
      );

      let called = false;
      await run(b, {
        sideEffect() {
          called = true;
        },
      });
      assert(called);
    });

    it('should insert esModule flag for interop for async (or shared) bundles', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/interop-async/index.html',
        ),
        {
          mode: 'production',
          defaultTargetOptions: {
            shouldOptimize: false,
          },
        },
      );

      let res = await run(b, {output: null}, {require: false});
      assert.deepEqual(await res.output, ['client', 'client', 'viewer']);
    });

    it('should enable minifier to remove unused modules despite of interopDefault', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/interop-pure/a.js',
        ),
        {
          mode: 'production',
          defaultTargetOptions: {
            shouldOptimize: true,
            sourceMaps: false,
          },
        },
      );

      let contents = await outputFS.readFileSync(
        b.getBundles()[0].filePath,
        'utf8',
      );
      assert.strictEqual(contents.trim().length, 0);
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
      assert(!contents.includes('exports.bar ='));
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

    it('should correctly handle circular dependencies', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/scope-hoisting/es6/circular/a.mjs'),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'b.mjs')))),
        new Set(['foo']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'c.mjs')))),
        new Set(['run']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'b.mjs', './c.mjs'))),
        new Set(['run']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'c.mjs', './b.mjs'))),
        new Set(['foo']),
      );

      let output = await run(b);
      assert.strictEqual(output, 'c:foo');
    });

    it('should correctly handle circular dependencies (2)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/scope-hoisting/es6/circular2/a.mjs'),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'b.mjs')))),
        new Set(['run', 'foo']),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'c.mjs')))),
        new Set([]),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'b.mjs', './c.mjs'))),
        new Set(['foo']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'c.mjs', './b.mjs'))),
        new Set(['foo']),
      );

      let output = await run(b);
      assert.strictEqual(output, 'b:foo:foo');
    });

    it('should correctly handle circular dependencies (3)', async function() {
      let b = await bundle(
        path.join(__dirname, '/integration/scope-hoisting/es6/circular3/a.mjs'),
      );

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'b.mjs')))),
        new Set([]),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'c.mjs')))),
        new Set(['a']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'd.mjs')))),
        new Set([]),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'a.mjs', './b.mjs'))),
        new Set(['h']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'b.mjs', './c.mjs'))),
        new Set(['a', 'd', 'g']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'c.mjs', './d.mjs'))),
        new Set(['c', 'f']),
      );
      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(findDependency(b, 'd.mjs', './b.mjs'))),
        new Set(['b', 'e']),
      );

      let output = await run(b);
      assert.strictEqual(output, 123);
    });

    it('should handle circular dependencies with wrapped assets', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/circular-wrap/index.mjs',
        ),
      );

      let output = [];
      await run(b, {
        output(o) {
          output.push(o);
        },
      });

      assert.deepEqual(output, ['d', 'c', 'b', 'a', 'index']);
    });

    it('does not tree-shake assignments to unknown objects', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/tree-shaking-no-unknown-objects/index.js',
        ),
      );

      assert.equal(await run(b), 42);
    });

    it('can conditionally reference an imported symbol and unconditionally reference it', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/conditional-import-reference/index.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'hello');
    });

    it('can conditionally reference an imported symbol from another bundle in a case clause', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/async-interop-conditional/index.js',
        ),
      );

      let output = await run(b);
      assert.equal(await output, 42);
    });

    describe('correctly updates used symbols on changes', () => {
      it('dependency symbols change', async function() {
        let testDir = path.join(
          __dirname,
          '/integration/scope-hoisting/es6/update-used-symbols-dependency-symbols',
        );

        let b = bundler(path.join(testDir, 'index.js'), {
          inputFS: overlayFS,
          outputFS: overlayFS,
        });

        await overlayFS.mkdirp(testDir);
        await overlayFS.copyFile(
          path.join(testDir, 'index.1.js'),
          path.join(testDir, 'index.js'),
        );

        let subscription = await b.watch();

        try {
          let bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          let output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, [123]);

          assertDependencyWasDeferred(
            bundleEvent.bundleGraph,
            'a.js',
            './c.js',
          );

          await overlayFS.copyFile(
            path.join(testDir, 'index.2.js'),
            path.join(testDir, 'index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, [123, 789]);

          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findAsset(bundleEvent.bundleGraph, 'c.js'),
              ),
            ),
            new Set(['c']),
          );

          await overlayFS.copyFile(
            path.join(testDir, 'index.1.js'),
            path.join(testDir, 'index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, [123]);

          assert(!findAsset(bundleEvent.bundleGraph, 'c.js'));
        } finally {
          await subscription.unsubscribe();
        }
      });

      it('add and remove dependency', async function() {
        let testDir = path.join(
          __dirname,
          '/integration/scope-hoisting/es6/update-used-symbols-dependency-add',
        );

        let b = bundler(path.join(testDir, 'index.js'), {
          inputFS: overlayFS,
          outputFS: overlayFS,
        });

        await overlayFS.mkdirp(testDir);
        await overlayFS.copyFile(
          path.join(testDir, 'index.1.js'),
          path.join(testDir, 'index.js'),
        );

        let subscription = await b.watch();

        try {
          let bundleEvent = await getNextBuild(b);
          assert(bundleEvent.type === 'buildSuccess');
          let output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, [123]);

          let assetC = nullthrows(findAsset(bundleEvent.bundleGraph, 'd1.js'));
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetC)),
            new Set(['a']),
          );
          assert(!findAsset(bundleEvent.bundleGraph, 'd2.js'));

          await overlayFS.copyFile(
            path.join(testDir, 'index.2.js'),
            path.join(testDir, 'index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, [
            123,
            789,
            {
              d1: 1,
              d2: 2,
            },
          ]);

          assetC = nullthrows(findAsset(bundleEvent.bundleGraph, 'd1.js'));
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetC)),
            new Set(['a', 'b']),
          );
          let assetD = nullthrows(findAsset(bundleEvent.bundleGraph, 'd2.js'));
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetD)),
            new Set(['*']),
          );

          await overlayFS.copyFile(
            path.join(testDir, 'index.1.js'),
            path.join(testDir, 'index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, [123]);

          assetC = nullthrows(findAsset(bundleEvent.bundleGraph, 'd1.js'));
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetC)),
            new Set(['a']),
          );
          assert(!findAsset(bundleEvent.bundleGraph, 'd2.js'));
        } finally {
          await subscription.unsubscribe();
        }
      });

      it('add and remove dependency with inline asset', async function() {
        let testDir = path.join(
          __dirname,
          '/integration/scope-hoisting/es6/update-used-symbols-dependency-add-inline',
        );

        let b = bundler(path.join(testDir, 'index.js'), {
          inputFS: overlayFS,
          outputFS: overlayFS,
        });

        await overlayFS.mkdirp(testDir);
        await overlayFS.copyFile(
          path.join(testDir, 'other.1.js'),
          path.join(testDir, 'other.js'),
        );

        let subscription = await b.watch();

        try {
          let bundleEvent = await getNextBuild(b);
          assert(bundleEvent.type === 'buildSuccess');
          let output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, 123);

          let assetOther = nullthrows(
            findAsset(bundleEvent.bundleGraph, 'other.js'),
          );
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetOther)),
            new Set([]),
          );

          await overlayFS.copyFile(
            path.join(testDir, 'other.2.js'),
            path.join(testDir, 'other.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, 1);

          assetOther = nullthrows(
            findAsset(bundleEvent.bundleGraph, 'other.js'),
          );
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetOther)),
            new Set(['a']),
          );

          await overlayFS.copyFile(
            path.join(testDir, 'other.1.js'),
            path.join(testDir, 'other.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          output = await run(bundleEvent.bundleGraph);
          assert.deepEqual(output, 123);

          assetOther = nullthrows(
            findAsset(bundleEvent.bundleGraph, 'other.js'),
          );
          assert.deepStrictEqual(
            new Set(bundleEvent.bundleGraph.getUsedSymbols(assetOther)),
            new Set([]),
          );
          assert(!findAsset(bundleEvent.bundleGraph, 'd2.js'));
        } finally {
          await subscription.unsubscribe();
        }
      });

      it('add and remove dependency with namespace', async function() {
        let testDir = path.join(
          __dirname,
          '/integration/scope-hoisting/es6/update-used-symbols-dependency-add-namespace',
        );

        let b = bundler(path.join(testDir, 'index.html'), {
          inputFS: overlayFS,
          outputFS: overlayFS,
        });

        await overlayFS.mkdirp(testDir);
        await overlayFS.copyFile(
          path.join(testDir, 'index.1.js'),
          path.join(testDir, 'index.js'),
        );

        let subscription = await b.watch();

        try {
          let bundleEvent = await getNextBuild(b);
          assert(bundleEvent.type === 'buildSuccess');
          let res = await run(
            bundleEvent.bundleGraph,
            {output: null},
            {require: false},
          );
          assert.deepEqual(await res.output, {akGridSize: 8});

          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findAsset(bundleEvent.bundleGraph, 'themeConstants.js'),
              ),
            ),
            new Set(['gridSize']),
          );
          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findDependency(
                  bundleEvent.bundleGraph,
                  'theme.js',
                  './themeColors',
                ),
              ),
            ),
            new Set(),
          );
          assert(!findAsset(bundleEvent.bundleGraph, 'themeColors.js'));

          await overlayFS.copyFile(
            path.join(testDir, 'index.2.js'),
            path.join(testDir, 'index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          res = await run(
            bundleEvent.bundleGraph,
            {output: null},
            {require: false},
          );
          assert.deepEqual(await res.output, [
            {akGridSize: 8},
            {akEmojiSelectedBackgroundColor: '#EBECF0'},
          ]);

          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findAsset(bundleEvent.bundleGraph, 'themeConstants.js'),
              ),
            ),
            new Set(['borderRadius', 'gridSize']),
          );
          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findDependency(
                  bundleEvent.bundleGraph,
                  'theme.js',
                  './themeColors',
                ),
              ),
            ),
            new Set('*'),
          );

          await overlayFS.copyFile(
            path.join(testDir, 'index.1.js'),
            path.join(testDir, 'index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          res = await run(
            bundleEvent.bundleGraph,
            {output: null},
            {require: false},
          );
          assert.deepEqual(await res.output, {akGridSize: 8});

          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findAsset(bundleEvent.bundleGraph, 'themeConstants.js'),
              ),
            ),
            new Set(['gridSize']),
          );
          assert.deepStrictEqual(
            new Set(
              bundleEvent.bundleGraph.getUsedSymbols(
                findDependency(
                  bundleEvent.bundleGraph,
                  'theme.js',
                  './themeColors',
                ),
              ),
            ),
            new Set(),
          );
        } finally {
          await subscription.unsubscribe();
        }
      });
    });

    describe('sideEffects: false', function() {
      it('supports excluding unused CSS imports', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-css/index.html',
          ),
        );

        assertBundles(b, [
          {
            name: 'index.html',
            assets: ['index.html'],
          },
          {
            type: 'js',
            assets: ['index.js', 'a.js', 'b1.js'],
          },
          {
            type: 'css',
            assets: ['b1.css'],
          },
        ]);

        let calls = [];
        let res = await run(
          b,
          {
            output: null,
            sideEffect: caller => {
              calls.push(caller);
            },
          },
          {require: false},
        );
        assert.deepEqual(calls, ['b1']);
        assert.deepEqual(res.output, 2);

        let css = await outputFS.readFile(
          b.getBundles().find(bundle => bundle.type === 'css').filePath,
          'utf8',
        );
        assert(!css.includes('.b2'));
      });

      it("doesn't create new bundles for dynamic imports in excluded assets", async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-no-new-bundle/index.html',
          ),
        );

        assertBundles(b, [
          {
            name: 'index.html',
            assets: ['index.html'],
          },
          {
            type: 'js',
            assets: ['index.js', 'a.js', 'b1.js'],
          },
        ]);

        let calls = [];
        let res = await run(
          b,
          {
            output: null,
            sideEffect: caller => {
              calls.push(caller);
            },
          },
          {require: false},
        );
        assert.deepEqual(calls, ['b1']);
        assert.deepEqual(res.output, 2);
      });

      it('supports deferring an unused ES6 re-exports (namespace used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports/a.js',
          ),
        );

        assertDependencyWasDeferred(b, 'index.js', './message2.js');
        assert(!findAsset(b, 'message3.js'));

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['message1']);
        assert.deepEqual(output, 'Message 1');
      });

      it('supports deferring an unused ES6 re-export (wildcard, empty, unused)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-all-empty/a.js',
          ),
        );

        assertDependencyWasDeferred(b, 'index.js', './empty.js');

        assert.deepEqual(await run(b), 123);
      });

      it('supports deferring an unused ES6 re-exports (reexport named used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports/b.js',
          ),
        );

        assert(!findAsset(b, 'message1.js'));
        assert(!findAsset(b, 'message3.js'));

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['message2']);
        assert.deepEqual(output, 'Message 2');
      });

      it('supports deferring an unused ES6 re-exports (namespace rename used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports/c.js',
          ),
        );

        assert(!findAsset(b, 'message1.js'));
        assertDependencyWasDeferred(b, 'index.js', './message2.js');

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['message3']);
        assert.deepEqual(output, {default: 'Message 3'});
      });

      it('supports deferring an unused ES6 re-exports (direct export used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports/d.js',
          ),
        );

        assert(!findAsset(b, 'message1.js'));
        assertDependencyWasDeferred(b, 'index.js', './message2.js');
        assert(!findAsset(b, 'message13js'));

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['index']);
        assert.deepEqual(output, 'Message 4');
      });

      it('supports chained ES6 re-exports', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-chained/index.js',
          ),
        );

        assert(!findAsset(b, 'bar.js'));

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['key', 'foo', 'index']);
        assert.deepEqual(output, ['key', 'foo']);
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

      it('should not optimize away an unused ES6 re-export and an used import (different symbols)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-import-different/a.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, 123);
      });

      it('correctly handles ES6 re-exports in library mode entries', async function() {
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
            '/integration/scope-hoisting/es6/side-effects-re-exports-multiple-dynamic/a.js',
          ),
        );

        let contents = await outputFS.readFile(
          b.getBundles()[0].filePath,
          'utf8',
        );

        assert(!contents.includes('$import$'));
        assert(contents.includes('= 1234;'));
        assert(!contents.includes('= 5678;'));

        let output = await run(b);
        assert.deepEqual(output, [1234, {default: 1234}]);
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

      it('supports removing a deferred dependency', async function() {
        let testDir = path.join(
          __dirname,
          '/integration/scope-hoisting/es6/side-effects-false',
        );

        let b = bundler(path.join(testDir, 'a.js'), {
          inputFS: overlayFS,
          outputFS: overlayFS,
        });

        let subscription = await b.watch();

        try {
          let bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          let called = false;
          let output = await run(bundleEvent.bundleGraph, {
            sideEffect: () => {
              called = true;
            },
          });
          assert(!called, 'side effect called');
          assert.deepEqual(output, 4);
          assertDependencyWasDeferred(
            bundleEvent.bundleGraph,
            'index.js',
            './bar',
          );

          await overlayFS.mkdirp(path.join(testDir, 'node_modules/bar'));
          await overlayFS.copyFile(
            path.join(testDir, 'node_modules/bar/index.1.js'),
            path.join(testDir, 'node_modules/bar/index.js'),
          );

          bundleEvent = await getNextBuild(b);
          assert.strictEqual(bundleEvent.type, 'buildSuccess');
          called = false;
          output = await run(bundleEvent.bundleGraph, {
            sideEffect: () => {
              called = true;
            },
          });
          assert(!called, 'side effect called');
          assert.deepEqual(output, 4);
        } finally {
          await subscription.unsubscribe();
        }
      });

      it('supports wildcards', async function() {
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

      it('correctly handles excluded and wrapped reexport assets', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-false-wrap-excluded/a.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, 4);
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

      it('supports the package.json sideEffects: false flag with shared dependencies and code splitting', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-split/a.js',
          ),
        );

        assert.deepEqual(await run(b), 581);
      });

      it('supports the package.json sideEffects: false flag with shared dependencies and code splitting II', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-split2/a.js',
          ),
        );

        assert.deepEqual(await run(b), [{default: 123, foo: 2}, 581]);
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

      it('supports namespace imports of theoretically excluded reexporting assets', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/import-namespace-sideEffects/index.js',
          ),
        );

        let output = await run(b);
        assert.deepEqual(output, {Main: 'main', a: 'foo', b: 'bar'});
      });

      it('can import from a different bundle via a re-export', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/re-export-bundle-boundary-side-effects/index.js',
          ),
        );
        let output = await run(b);
        assert.deepEqual(output, ['operational', 'ui']);
      });

      it('supports excluding multiple chained namespace reexports', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-chained-re-exports-multiple/a.js',
          ),
        );

        assert(!findAsset(b, 'symbol1.js'));

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['message1']);
        assert.deepEqual(output, 'Message 1');
      });

      it('supports excluding when doing both exports and reexports', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-export-reexport/a.js',
          ),
        );

        assert(!findAsset(b, 'other.js'));

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['index']);
        assert.deepEqual(output, 'Message 1');
      });

      it('supports deferring with chained renaming reexports', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-rename-chained/a.js',
          ),
        );

        // assertDependencyWasDeferred(b, 'message.js', './message2');

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['message1']);
        assert.deepEqual(output, 'Message 1');
      });

      it('supports named and renamed reexports of the same asset (default used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-rename-same2/a.js',
          ),
        );

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'other.js')))),
          new Set(['bar']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['other']);
        assert.deepEqual(output, 'bar');
      });

      it('supports named and renamed reexports of the same asset (named used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-rename-same2/b.js',
          ),
        );

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'other.js')))),
          new Set(['bar']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['other']);
        assert.deepEqual(output, 'bar');
      });

      it('removes functions that increment variables in object properties', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/tree-shaking-increment-object/a.js',
          ),
          {
            defaultTargetOptions: {
              shouldOptimize: true,
            },
          },
        );

        let content = await outputFS.readFile(
          b.getBundles()[0].filePath,
          'utf8',
        );
        assert(!content.includes('++'));

        await run(b);
      });

      it('supports named and namespace exports of the same asset (named used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-namespace-same/a.js',
          ),
        );

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'index.js')))),
          new Set([]),
        );
        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'other.js')))),
          new Set(['default']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['other']);
        assert.deepEqual(output, ['foo']);
      });

      it('supports named and namespace exports of the same asset (namespace used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-namespace-same/b.js',
          ),
        );

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'index.js')))),
          new Set([]),
        );
        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'other.js')))),
          new Set(['bar']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['other']);
        assert.deepEqual(output, ['bar']);
      });

      it('supports named and namespace exports of the same asset (both used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-re-exports-namespace-same/c.js',
          ),
        );

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'index.js')))),
          new Set([]),
        );
        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'other.js')))),
          new Set(['default', 'bar']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['other']);
        assert.deepEqual(output, ['foo', 'bar']);
      });

      it('supports deferring non-weak dependencies that are not used', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-semi-weak/a.js',
          ),
        );

        // assertDependencyWasDeferred(b, 'esm2.js', './other.js');

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['esm1']);
        assert.deepEqual(output, 'Message 1');
      });

      it('supports excluding CommonJS (CommonJS unused)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-commonjs/a.js',
          ),
        );

        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'esm.js')))),
          new Set(['message1']),
        );
        // We can't statically analyze commonjs.js, so message1 appears to be used
        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'commonjs.js')))),
          // the exports object is used freely
          new Set(['*', 'message1']),
        );
        assert.deepStrictEqual(
          new Set(
            b.getUsedSymbols(findDependency(b, 'index.js', './commonjs.js')),
          ),
          new Set(['message1']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['esm', 'commonjs']);
        assert.deepEqual(output, 'Message 1');
      });

      it('supports excluding CommonJS (CommonJS used)', async function() {
        let b = await bundle(
          path.join(
            __dirname,
            '/integration/scope-hoisting/es6/side-effects-commonjs/b.js',
          ),
        );

        assert(!findAsset(b, 'esm.js'));
        assert.deepStrictEqual(
          new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'commonjs.js')))),
          // the exports object is used freely
          new Set(['*', 'message2']),
        );
        assert.deepEqual(
          new Set(
            b.getUsedSymbols(findDependency(b, 'index.js', './commonjs.js')),
          ),
          new Set(['message2']),
        );

        let calls = [];
        let output = await run(b, {
          sideEffect: caller => {
            calls.push(caller);
          },
        });

        assert.deepEqual(calls, ['commonjs']);
        assert.deepEqual(output, 'Message 2');
      });
    });

    it('ignores missing import specifiers in source assets', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/unused-import-specifier/a.js',
        ),
      );
      let output = await run(b);
      assert.equal(output, 123);
    });

    it('ignores unused import specifiers in node-modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/unused-import-specifier-node-modules/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 123);
    });

    it('can import urls to raw assets', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/raw-url/index-import.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(
          b.getUsedSymbols(
            findDependency(b, 'index-import.js', 'url:./foo.png'),
          ),
        ),
        new Set(['default']),
      );

      let output = await run(b);
      assert(/foo\.[a-f0-9]+\.png$/.test(output));
    });

    it('can reexport urls to raw assets', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/es6/raw-url/index-reexport.js',
        ),
      );

      assert.deepStrictEqual(
        new Set(
          b.getUsedSymbols(
            findDependency(b, 'index-reexport.js', './reexports'),
          ),
        ),
        new Set(['assetUrl']),
      );
      assert.deepStrictEqual(
        new Set(
          b.getUsedSymbols(findDependency(b, 'reexports.js', 'url:./foo.png')),
        ),
        new Set(['default']),
      );

      let output = await run(b);
      assert(/foo\.[a-f0-9]+\.png$/.test(output));
    });

    it('should wrap modules in shared bundles', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5659
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/shared-bundle-side-effect-order/index.js',
        ),
        {mode: 'production'},
      );

      let sideEffects = [];
      let res = await run(b, {
        sideEffect(out) {
          sideEffects.push(out);
        },
      });
      await res;
      assert.deepEqual(sideEffects, ['shared1', 'run1 1', 'shared2', 'run2 2']);
    });

    it('should ensure that modules are only executed once in shared bundles', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5659
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/shared-bundle-side-effect-duplication/index.js',
        ),
        {mode: 'production'},
      );

      let sideEffects = [];
      let res = await run(b, {
        sideEffect(out) {
          sideEffects.push(out);
        },
      });
      await res;
      assert.deepEqual(sideEffects, ['v']);
    });

    it('should error when assigning to a named import', async function() {
      let source = path.join(
        __dirname,
        'integration/scope-hoisting/es6/import-local-assign/named.js',
      );

      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message: 'Assignment to an import specifier is not allowed',
        diagnostics: [
          {
            message: 'Assignment to an import specifier is not allowed',
            origin: '@parcel/transformer-js',
            codeFrames: [
              {
                filePath: source,
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 2,
                      column: 1,
                    },
                    end: {
                      line: 2,
                      column: 3,
                    },
                  },
                  {
                    message: 'Originally imported here',
                    start: {
                      line: 1,
                      column: 9,
                    },
                    end: {
                      line: 1,
                      column: 11,
                    },
                  },
                ],
              },
            ],
            hints: null,
          },
        ],
      });
    });

    it('should error when assigning to a default import', async function() {
      let source = path.join(
        __dirname,
        'integration/scope-hoisting/es6/import-local-assign/default.js',
      );

      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message: 'Assignment to an import specifier is not allowed',
        diagnostics: [
          {
            message: 'Assignment to an import specifier is not allowed',
            origin: '@parcel/transformer-js',
            codeFrames: [
              {
                filePath: source,
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 2,
                      column: 1,
                    },
                    end: {
                      line: 2,
                      column: 1,
                    },
                  },
                  {
                    message: 'Originally imported here',
                    start: {
                      line: 1,
                      column: 8,
                    },
                    end: {
                      line: 1,
                      column: 8,
                    },
                  },
                ],
              },
            ],
            hints: null,
          },
        ],
      });
    });

    it('should error when assigning to a namespace import', async function() {
      let source = path.join(
        __dirname,
        'integration/scope-hoisting/es6/import-local-assign/namespace.js',
      );

      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message: 'Assignment to an import specifier is not allowed',
        diagnostics: [
          {
            message: 'Assignment to an import specifier is not allowed',
            origin: '@parcel/transformer-js',
            codeFrames: [
              {
                filePath: source,
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 2,
                      column: 1,
                    },
                    end: {
                      line: 2,
                      column: 1,
                    },
                  },
                  {
                    message: 'Originally imported here',
                    start: {
                      line: 1,
                      column: 13,
                    },
                    end: {
                      line: 1,
                      column: 13,
                    },
                  },
                ],
              },
            ],
            hints: null,
          },
        ],
      });
    });

    it('should error with a destructuring assignment to a namespace import', async function() {
      let source = path.join(
        __dirname,
        'integration/scope-hoisting/es6/import-local-assign/destructure-assign.js',
      );

      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message: 'Assignment to an import specifier is not allowed',
        diagnostics: [
          {
            message: 'Assignment to an import specifier is not allowed',
            origin: '@parcel/transformer-js',
            codeFrames: [
              {
                filePath: source,
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 2,
                      column: 8,
                    },
                    end: {
                      line: 2,
                      column: 10,
                    },
                  },
                  {
                    message: 'Originally imported here',
                    start: {
                      line: 1,
                      column: 9,
                    },
                    end: {
                      line: 1,
                      column: 11,
                    },
                  },
                ],
              },
            ],
            hints: null,
          },
        ],
      });
    });

    it('should error with multiple assignments to an import', async function() {
      let source = path.join(
        __dirname,
        'integration/scope-hoisting/es6/import-local-assign/multiple.js',
      );

      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message: 'Assignment to an import specifier is not allowed',
        diagnostics: [
          {
            message: 'Assignment to an import specifier is not allowed',
            origin: '@parcel/transformer-js',
            codeFrames: [
              {
                filePath: source,
                codeHighlights: [
                  {
                    message: null,
                    start: {
                      line: 2,
                      column: 1,
                    },
                    end: {
                      line: 2,
                      column: 3,
                    },
                  },
                  {
                    message: null,
                    start: {
                      line: 3,
                      column: 1,
                    },
                    end: {
                      line: 3,
                      column: 3,
                    },
                  },
                  {
                    message: 'Originally imported here',
                    start: {
                      line: 1,
                      column: 9,
                    },
                    end: {
                      line: 1,
                      column: 11,
                    },
                  },
                ],
              },
            ],
            hints: null,
          },
        ],
      });
    });

    it('should allow re-declaring __esModule interop flag', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/double-esmodule/index.js',
        ),
      );

      let res = await run(b);
      assert.deepEqual(res, 'default');
    });

    it('can dynamically import a side-effect-free reexport', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/conditional-import-side-effect-free-reexport/index.mjs',
        ),
      );

      assert.deepEqual(await run(b), 42);
    });

    it('individually exports symbols from intermediately wrapped reexports', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/export-intermediate-wrapped-reexports/index.mjs',
        ),
      );

      let res = await Promise.all(await run(b));
      assert.deepEqual(res, [42, 42]);
    });

    it('should treat type-only TypeScript modules as ESM', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/empty-ts/index.ts',
        ),
      );

      let test = await run(b);
      assert.equal(test({foo: 2}), 2);
    });

    it('should not include default when reexporting * without $parcel$exportWildcard', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/no-reexport-default/index.js',
        ),
      );

      assert.equal(await run(b), 42);
    });

    it('should not include __esModule when reexporting * without $parcel$exportWildcard', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/es6/no-reexport-esmodule/index.js',
        ),
      );

      assert.equal(await run(b), undefined);
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

    it('bails out imported exports access resolving if it is accessed freely (exports assign)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/exports-assign-entry.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out imported exports access resolving if it is accessed freely (exports define)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/exports-define-entry.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out imported exports access resolving if it is accessed freely (module.exports assign)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/module-exports-assign-entry.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out imported exports access resolving if it is accessed freely (module.exports define)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/module-exports-define-entry.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 5);
    });

    it('bails out imported exports access resolving if it is accessed freely (exports reexport)', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-access-bailout/exports-assign-reexport-entry.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, [5, 5]);
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

    it('should support assigning to module.exports with another export', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5782
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/module-exports-default-assignment/index.js',
        ),
      );

      let output = await run(b);
      assert.equal(output.foo, 'b');
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

      assert.deepStrictEqual(
        new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'a.js')))),
        new Set(['*']),
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

    it('should remove unused exports assignments for wrapped modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-unused/a.js',
        ),
      );

      // console.log(await outputFS.readFile(b.getBundles()[0].filePath, 'utf8'));

      let output = await run(b);
      assert.equal(output, 1);
    });

    it('should hoist all vars in the scope', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-var-hoisting/a.js',
        ),
      );

      let contents = await outputFS.readFile(
        b.getBundles()[0].filePath,
        'utf8',
      );

      assert(contents.split('f1_var').length - 1, 1);
      assert(contents.split('f2_var').length - 1, 1);
      assert(contents.split('f3_var').length - 1, 1);
      assert(contents.split('f4_var').length - 1, 1);
      assert(contents.split('c1_var').length - 1, 1);
      assert(contents.split('c2_var').length - 1, 1);
      assert(contents.split('BigIntSupported').length - 1, 4);
      assert(contents.split('inner_let').length - 1, 2);

      let output = await run(b);
      assert.equal(output, true);
    });

    it('should wrap modules that access `module` as a free variable', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-module/a.js',
        ),
      );

      assert.deepEqual((await run(b)).exports, {foo: 2});
    });

    it('should call init for wrapped modules when codesplitting', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-module-codesplit/a.js',
        ),
      );

      assert.deepEqual(await run(b), 2);
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

    it('should support typeof require when wrapped', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5883
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-typeof-require/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'c1');
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

    it('supports using this in arrow functions', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/this-arrow-function/a.js',
        ),
      );

      let content = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(content.includes('=>'));

      let output = await run(b);
      assert.strictEqual(output, 'Say other');
    });

    it('supports assigning to this as exports object', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/this-reference/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output, 2);
    });

    it('supports assigning to this as exports object in wrapped module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/this-reference-wrapped/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output, 6);
    });

    it('supports using exports self reference', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/exports-self-reference/a.js',
        ),
      );

      let content = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(content.includes('=>'));

      let output = await run(b);
      assert.strictEqual(output, 'Say other');
    });

    it('supports using module.exports self reference', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/module-exports-self-reference/a.js',
        ),
      );

      let content = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
      assert(content.includes('=>'));

      let output = await run(b);
      assert.strictEqual(output, 'Say other');
    });

    it('support url imports in wrapped modules with interop', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-interop-url-import/a.js',
        ),
      );

      assertBundles(b, [
        {
          type: 'js',
          assets: ['a.js', 'b.js', 'bundle-url.js'],
        },
        {
          type: 'txt',
          assets: ['data.txt'],
        },
      ]);

      let output = await run(b);
      assert(output.endsWith('.txt'));
    });

    it('supports module object properties', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/module-object/a.js',
        ),
      );

      let entryAsset = b.getBundles()[0].getMainEntry();

      // TODO: this test doesn't currently work in older browsers since babel
      // replaces the typeof calls before we can get to them.
      let output = await run(b);
      assert.equal(output.id, b.getAssetPublicId(entryAsset));
      assert.equal(output.hot, null);
      assert.equal(output.moduleRequire, null);
      assert.equal(output.type, 'object');
      assert.deepEqual(output.exports, {});
      assert.equal(output.exportsType, 'object');
      assert.equal(output.require, 'function');
    });

    it.skip("doesn't support require.resolve calls for included assets", async function() {
      let message =
        "'require.resolve' calls for bundled modules or bundled assets aren't supported with scope hoisting";
      let source = path.join(
        __dirname,
        '/integration/scope-hoisting/commonjs/require-resolve/a.js',
      );
      await assert.rejects(() => bundle(source), {
        name: 'BuildError',
        message,
        diagnostics: [
          {
            message,
            origin: '@parcel/packager-js',
            codeFrames: [
              {
                filePath: source,
                language: 'js',
                codeHighlights: [
                  {
                    start: {
                      line: 3,
                      column: 10,
                    },
                    end: {
                      line: 3,
                      column: 31,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it('supports mutations of the exports object by the importer', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/mutated-exports-object-importer/index.js',
        ),
      );

      assert.deepEqual(await run(b), [43, {foo: 43}]);
    });

    it('supports mutations of the exports object by a different asset', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/mutated-exports-object-different/index.js',
        ),
      );

      assert.equal(await run(b), 43);
    });

    it('supports mutations of the exports object inside an expression', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/mutated-exports-object-expression/index.js',
        ),
      );

      assert.deepEqual(await run(b), [{foo: 3}, 3, 3]);
    });

    it('supports non-static mutations of the exports object', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5591
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/mutated-non-static-require/index.js',
        ),
      );

      assert.deepEqual(await run(b), 4);
    });

    it.skip('supports require.resolve calls for excluded modules', async function() {
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

    it('should support assets requiring themselves', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-self/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output, 4);
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

    it('supports requiring a CSS asset', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-css/a.js',
        ),
      );

      assertBundles(b, [
        {
          name: 'a.js',
          assets: ['a.js'],
        },
        {
          type: 'css',
          assets: ['b.css'],
        },
      ]);

      await run(b);
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
        {mode: 'production'},
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

    it('removes unused exports when assigning with a string literal', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/tree-shaking-string/a.js',
        ),
        {mode: 'production'},
      );

      let output = await run(b);
      assert.deepEqual(output, [2, 20]);

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
        {
          defaultTargetOptions: {
            shouldOptimize: true,
          },
        },
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

    it('can bundle browserify-produced umd bundles', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/browserify-compat/index.js',
        ),
      );

      assert.equal(await run(b), 'foo');
    });

    it('replaces properties of require with undefined', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-extensions/index.js',
        ),
      );

      await run(b);
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

    it('should retain the correct concat order with wrapped assets', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-concat-order/a.js',
        ),
      );

      let calls = [];
      await run(b, {
        sideEffect(v) {
          calls.push(v);
        },
      });
      assert.deepStrictEqual(calls, [1, 2, 3, 4, 5, 6, 7]);
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

      assert.equal(await run(b), 'bar:bar');
    });

    it('should export the same values for interop shared modules in main and child bundle if shared bundle is deep nested', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/interop-require-es-module-code-split-intermediate/main.js',
        ),
      );

      assert.equal(await run(b), 'bar:bar');
    });

    it('should not insert interop default for commonjs modules with default export', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/interop-require-commonjs/a.js',
        ),
      );

      let output = await run(b);
      let obj = {
        test: 2,
      };
      obj.default = obj;
      assert.deepEqual(output.default, obj);
    });

    it('should not insert default interop for wrapped CJS modules', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/interop-require-commonjs-wrapped/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'default');
    });

    it('should support multiple requires in the same variable declaration', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-multiple/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'before foo middle bar after');
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

    it('does not tree-shake assignments to unknown objects', async () => {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/tree-shaking-no-unknown-objects/index.js',
        ),
      );

      assert.equal(await run(b), 42);
    });

    it('can conditionally reference an imported symbol and unconditionally reference it', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/conditional-import-reference/index.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 'hello');
    });

    it('supports assigning to the result of a require', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-assign/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 4);
    });

    it('supports both static and non-static exports in the same module with self-reference', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/non-static-exports/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        foo: 2,
        bar: 4,
        baz: 6,
      });
    });

    it('does not replace assignments to the exports object in the same module', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/self-reference-assignment/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output, {
        foo: {
          bar: 'bar',
        },
      });
    });

    it('replaces static require member expressions with the correct `this` context', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-member-wrapped/a.js',
        ),
      );

      let output = await run(b);
      assert.deepEqual(output(), {
        foo: 2,
        bar: 4,
      });
    });

    it('does not create a self-referencing dependency for the default symbol without an __esModule flag', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/self-reference-default/a.js',
        ),
      );

      let output = await run(b);
      assert.equal(output, 2);
    });

    it('should ensure that side effect ordering is correct in sequence expressions with require', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5606
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/commonjs/wrap-expressions/a.js',
        ),
      );

      let sideEffects = [];
      let res = await run(b, {
        sideEffect(out) {
          sideEffects.push(out);
        },
      });
      await res;
      assert.deepEqual(sideEffects, ['before', 'require', 'after']);
    });

    it('should ensure that side effect ordering is correct in binary expressions with require', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5606
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/commonjs/wrap-expressions/b.js',
        ),
      );

      let sideEffects = [];
      let res = await run(b, {
        sideEffect(out) {
          sideEffects.push(out);
        },
      });
      await res;
      assert.deepEqual(sideEffects, ['before', 'require', 'after']);
    });

    it('should ensure that side effect ordering is correct with default interop', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5662
      let b = await bundle(
        path.join(
          __dirname,
          'integration/scope-hoisting/commonjs/wrap-default-interop/index.js',
        ),
      );

      let sideEffects = [];
      let res = await run(b, {
        sideEffect(out) {
          sideEffects.push(out);
        },
      });
      await res;
      assert.deepEqual(sideEffects, ['shared', 'run1', 'async c: 123']);
    });

    it('should support non-object module.exports', async function() {
      // https://github.com/parcel-bundler/parcel/issues/5892
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/export-non-object/index.js',
        ),
      );

      await run(b, null, {strict: true});
    });

    it('should support assignment to a local variable with require', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-local-assign/basic.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [
        [{foo: 2}, {foo: 2}],
        [4, {foo: 2}],
      ]);
    });

    it('should support out of order assignment to a local variable with require', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-local-assign/in-function.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [
        [{foo: 2}, {foo: 2}],
        [4, {foo: 2}],
      ]);
    });

    it('should support assignment to a local variable with require and member expression', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-local-assign/member.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [
        [2, 2],
        [4, 2],
      ]);
    });

    it('should support assignment to a local variable with require and destructuring', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-local-assign/destructure.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [
        [2, 2],
        [4, 2],
      ]);
    });

    it('should support assignment to a local variable with require and non-static access', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-local-assign/destructure.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [
        [2, 2],
        [4, 2],
      ]);
    });

    it('should handle require as the callee in a new expression', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-new/a.js',
        ),
      );

      let output = await run(b);
      assert.strictEqual(output.foo(), 1);
    });

    it('should not update mutated destructured requires', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-non-const-export/destructure.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [2, 2]);
    });

    it('should not update mutated require members', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-non-const-export/member.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [2, 2]);
    });

    it('should update live mutated require members', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/require-non-const-export/live.js',
        ),
      );

      let outputs = [];
      await run(b, {
        output(x) {
          outputs.push(x);
        },
      });

      assert.deepEqual(outputs, [2, 3]);
    });

    it('should wrap all assets with an incoming wrapped dependency', async function() {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/scope-hoisting/commonjs/wrap-deps-circular/index.js',
        ),
      );

      assert.deepEqual(await run(b), {test: 2});
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
        assets: ['index.js', 'other.js'],
      },
    ]);

    let asset = nullthrows(findAsset(b, 'other.js'));
    assert.deepStrictEqual(
      new Set(b.getUsedSymbols(asset)),
      new Set(['default']),
    );

    let value = [];
    await run(b, {
      alert: v => value.push(v),
    });
    assert.deepEqual(value, ['other']);
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
        assets: ['index.js'],
      },
      {
        type: 'js',
        assets: ['local.js'],
      },
    ]);

    let res = await run(b, {output: null}, {require: false});
    assert.equal(typeof res.output, 'function');
    assert.equal(await res.output(), 'Imported: foobar');
  });

  it('should include the prelude in shared entry bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-shared/index.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
        },
      },
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
    assert(contents.includes(`if (parcelRequire == null) {`));
  });

  it.skip('does not include prelude if child bundles are isolated', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
    );

    let mainBundle = b.getBundles().find(b => b.name === 'index.js');
    let contents = await outputFS.readFile(mainBundle.filePath, 'utf8');
    // We wrap for other reasons now, so this is broken
    assert(!contents.includes(`if (parcelRequire == null) {`));
  });

  it('should include prelude in shared worker bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
        },
      },
    );

    let sharedBundle = b
      .getBundles()
      .sort((a, b) => b.stats.size - a.stats.size)
      .find(b => b.name !== 'index.js');
    let contents = await outputFS.readFile(sharedBundle.filePath, 'utf8');
    assert(contents.includes(`if (parcelRequire == null) {`));

    let workerBundle = b.getBundles().find(b => b.name.startsWith('worker-b'));
    contents = await outputFS.readFile(workerBundle.filePath, 'utf8');
    assert(
      contents.includes(
        `importScripts("./${path.basename(sharedBundle.filePath)}")`,
      ),
    );
  });

  // Mirrors the equivalent test in javascript.js
  it('should insert global variables when needed', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals/scope-hoisting.js'),
    );

    let output = await run(b);
    assert.deepEqual(output(), {
      dir: 'integration/globals',
      file: 'integration/globals/index.js',
      buf: Buffer.from('browser').toString('base64'),
      global: true,
    });
  });

  it('should be able to named import a reexported namespace in an async bundle', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/scope-hoisting/es6/async-named-import-ns-reexport/index.js',
      ),
    );

    assert.deepEqual(await run(b), [42, 42, 42, 42]);
  });

  it('should not remove a binding with a used AssignmentExpression', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/scope-hoisting/es6/used-assignmentexpression/a.js',
      ),
    );

    assert.strictEqual(await run(b), 3);
  });

  it('should wrap imports inside arrow functions', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/scope-hoisting/es6/wrap-import-arrowfunction/a.js',
      ),
    );

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('=>'));

    let calls = [];
    let output = await run(b, {
      sideEffect(id) {
        calls.push(id);
      },
    });
    assert.deepEqual(calls, []);
    assert.equal(typeof output, 'function');
    assert.deepEqual(await output(), {default: 1234});
    assert.deepEqual(calls, ['async']);
  });

  it('can static import and dynamic import in the same bundle without creating a new bundle', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/sync-async/same-bundle-scope-hoisting.js',
      ),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        name: 'same-bundle-scope-hoisting.js',
        assets: [
          'same-bundle-scope-hoisting.js',
          'get-dep.js',
          'get-dep-2.js',
          'dep.js',
        ],
      },
    ]);

    assert.deepEqual(await await run(b), [42, 42, 42]);
  });

  it('can static import and dynamic import in the same bundle ancestry without creating a new bundle', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/sync-async/same-ancestry-scope-hoisting.js',
      ),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        name: 'same-ancestry-scope-hoisting.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'dep.js',
          'js-loader.js',
          'same-ancestry-scope-hoisting.js',
        ],
      },
      {
        assets: ['get-dep.js'],
      },
    ]);

    assert.deepEqual(await run(b), [42, 42]);
  });

  it('loads another bundle from a dynamic import with a shared dependency only when necessary', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/sync-async-when-needed/index.js'),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {assets: ['dep.js']},
      {assets: ['async-has-dep.js', 'dep.js', 'get-dep.js']},
      {assets: ['get-dep.js']},
    ]);

    assert.deepEqual(await run(b), [42, 42]);
  });

  it('can static import and dynamic import in the same bundle when another bundle requires async', async () => {
    let b = await bundle(
      [
        'same-bundle-scope-hoisting.js',
        'get-dep-scope-hoisting.js',
      ].map(entry => path.join(__dirname, '/integration/sync-async/', entry)),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        assets: ['dep.js'],
      },
      {
        name: 'same-bundle-scope-hoisting.js',
        assets: [
          'same-bundle-scope-hoisting.js',
          'get-dep.js',
          'get-dep-2.js',
          'dep.js',
        ],
      },
      {
        name: 'get-dep-scope-hoisting.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'get-dep-scope-hoisting.js',
          'js-loader.js',
        ],
      },
    ]);

    let bundles = b.getBundles();
    let sameBundle = bundles.find(
      b => b.name === 'same-bundle-scope-hoisting.js',
    );
    let getDep = bundles.find(b => b.name === 'get-dep-scope-hoisting.js');

    assert.deepEqual(await runBundle(b, sameBundle), [42, 42, 42]);
    assert.deepEqual(await runBundle(b, getDep), 42);
  });

  it("can share dependencies between a shared bundle and its sibling's descendants", async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/shared-exports-for-sibling-descendant/scope-hoisting.js',
      ),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        assets: ['wraps.js', 'lodash.js'],
      },
      {
        assets: ['a.js'],
      },
      {
        assets: ['child.js'],
      },
      {
        assets: ['grandchild.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        name: 'scope-hoisting.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'scope-hoisting.js',
          'js-loader.js',
        ],
      },
    ]);

    assert.deepEqual(await run(b), [3, 5]);
  });

  it('deduplicates shared sibling assets between bundle groups', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-sibling-scope-hoist/index.js'),
    );

    assert.deepEqual(await run(b), ['a', 'b', 'c']);
  });

  it('can run an entry bundle whose entry asset is present in another bundle', async () => {
    let b = await bundle(
      ['index.js', 'value.js'].map(basename =>
        path.join(__dirname, '/integration/sync-entry-shared', basename),
      ),
      {targets: {main: {context: 'node', distDir, isLibrary: true}}},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {name: 'value.js', assets: ['value.js']},
      {assets: ['async.js']},
    ]);

    assert.equal(await (await run(b)).default, 43);
  });

  it('can run an async bundle whose entry asset is present in another bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/async-entry-shared/scope-hoisting.js'),
    );

    assertBundles(b, [
      {
        name: 'scope-hoisting.js',
        assets: [
          'scope-hoisting.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {assets: ['value.js']},
      {assets: ['async.js']},
    ]);

    assert.deepEqual(await run(b), [42, 43]);
  });

  it('can run an async bundle that depends on a nonentry asset in a sibling', async () => {
    let b = await bundle(
      ['scope-hoisting.js', 'other-entry.js'].map(basename =>
        path.join(
          __dirname,
          '/integration/async-entry-shared-sibling',
          basename,
        ),
      ),
    );

    assertBundles(b, [
      {
        name: 'scope-hoisting.js',
        assets: [
          'scope-hoisting.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        name: 'other-entry.js',
        assets: [
          'other-entry.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {assets: ['a.js', 'value.js']},
      {assets: ['b.js']},
    ]);

    assert.deepEqual(await run(b), 43);
  });

  it('correctly updates dependencies when a specifier is added', async function() {
    let testDir = path.join(
      __dirname,
      '/integration/scope-hoisting/es6/cache-add-specifier',
    );

    let b = bundler(path.join(testDir, 'a.js'), {
      inputFS: overlayFS,
      outputFS: overlayFS,
    });

    let subscription = await b.watch();

    let bundleEvent = await getNextBuild(b);
    assert(bundleEvent.type === 'buildSuccess');
    let output = await run(bundleEvent.bundleGraph);
    assert.deepEqual(output, 'foo');

    await overlayFS.mkdirp(testDir);
    await overlayFS.copyFile(
      path.join(testDir, 'a.1.js'),
      path.join(testDir, 'a.js'),
    );

    bundleEvent = await getNextBuild(b);
    assert(bundleEvent.type === 'buildSuccess');
    output = await run(bundleEvent.bundleGraph);
    assert.deepEqual(output, 'foobar');

    await subscription.unsubscribe();
  });

  it('should not rewrite this in arrow function class properties', async function() {
    let b = await bundle(
      path.join(__dirname, 'integration/js-class-this-esm/a.js'),
    );
    let res = await run(b);
    assert.deepEqual(res, 'x: 123');
  });

  it('should insert the prelude for sibling bundles referenced in HTML', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/scope-hoisting/es6/sibling-dependencies/index.html',
      ),
    );
    let res = await run(b, {output: null}, {require: false});
    assert.equal(res.output, 'a');
  });
});
