import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  runBundle,
  assertBundles,
  distDir,
  outputFS,
  overlayFS,
  fsFixture,
} from '@parcel/test-utils';
import postcss from 'postcss';

describe('css modules', () => {
  it('should support transforming css modules (require)', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-modules-cjs/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'foo.module.css'],
      },
      {
        name: 'index.css',
        assets: ['index.css', 'foo.module.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert(/[_0-9a-zA-Z]+_foo/.test(value));

    let cssClass = value.match(/([_0-9a-zA-Z]+_foo)/)[1];

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes(`.${cssClass}`));
  });

  it('should support transforming css modules (import default)', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/postcss-modules-import-default/index.js',
      ),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'style.module.css'],
      },
      {
        name: 'index.css',
        assets: ['style.module.css'],
      },
    ]);

    let output = await run(b);
    assert(/[_0-9a-zA-Z]+_b-2/.test(output));

    let css = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    let includedRules = new Set();
    postcss.parse(css).walkRules(rule => {
      includedRules.add(rule.selector);
    });
    assert(includedRules.has('.page'));
    assert(includedRules.has(`.${output}`));
  });

  it('should tree shake unused css modules classes with a namespace import', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/postcss-modules-import-namespace/index.js',
      ),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'style.module.css'],
      },
      {
        name: 'index.css',
        assets: ['global.css', 'style.module.css'],
      },
    ]);

    let js = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'js').filePath,
      'utf8',
    );
    assert(!js.includes('unused'));

    let output = await run(b);
    assert(/[_0-9a-zA-Z]+_b-2/.test(output));

    let css = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    let includedRules = new Set();
    postcss.parse(css).walkRules(rule => {
      includedRules.add(rule.selector);
    });
    assert.deepStrictEqual(
      includedRules,
      new Set(['body', `.${output}`, '.page']),
    );
  });

  it('should produce correct css without symbol propagation for css modules classes with a namespace import', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/postcss-modules-import-namespace/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'style.module.css'],
      },
      {
        name: 'index.css',
        assets: ['global.css', 'style.module.css'],
      },
    ]);

    let {output} = await run(b, null, {require: false});
    assert(/[_0-9a-zA-Z]+_b-2/.test(output));

    let css = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    let includedRules = new Set();
    postcss.parse(css).walkRules(rule => {
      includedRules.add(rule.selector);
    });
    assert(includedRules.has('body'));
    assert(includedRules.has(`.${output}`));
    assert(includedRules.has('.page'));
  });

  it('should support importing css modules with a non-static namespace import', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/postcss-modules-import-namespace-whole/index.js',
      ),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'style.module.css'],
      },
      {
        name: 'index.css',
        assets: ['global.css', 'style.module.css'],
      },
    ]);

    let js = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'js').filePath,
      'utf8',
    );
    assert(js.includes('unused'));

    let output = await run(b);
    assert(/[_0-9a-zA-Z]+_b-2/.test(output['b-2']));
    assert(/[_0-9a-zA-Z]+_unused/.test(output['unused']));

    let css = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    let includedRules = new Set();
    postcss.parse(css).walkRules(rule => {
      includedRules.add(rule.selector);
    });
    assert.deepStrictEqual(
      includedRules,
      new Set(['body', `.${output['b-2']}`, `.${output['unused']}`, '.page']),
    );
  });

  it('should support css modules composes imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'composes-1.module.css',
          'composes-2.module.css',
          'mixins.module.css',
        ],
      },
      {
        name: 'index.css',
        assets: [
          'composes-1.module.css',
          'composes-2.module.css',
          'mixins.module.css',
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes1Classes = value.composes1.split(' ');
    const composes2Classes = value.composes2.split(' ');
    assert(composes1Classes[0].endsWith('_composes1'));
    assert(composes1Classes[1].endsWith('_test'));
    assert(composes2Classes[0].endsWith('_composes2'));
    assert(composes2Classes[1].endsWith('_test'));

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    let cssClass1 = value.composes1.match(/([_0-9a-zA-Z]+_composes1)/)[1];
    assert(css.includes(`.${cssClass1}`));
    let cssClass2 = value.composes2.match(/([_0-9a-zA-Z]+_composes2)/)[1];
    assert(css.includes(`.${cssClass2}`));
  });

  it('should not include css twice for composes imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index.js'),
    );

    await run(b);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert.equal(
      css.indexOf('height: 100px;'),
      css.lastIndexOf('height: 100px;'),
    );
  });

  it('should support composes imports for sass', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index2.js'),
    );

    assertBundles(b, [
      {
        name: 'index2.js',
        assets: ['index2.js', 'composes-3.module.css', 'mixins.module.scss'],
      },
      {
        name: 'index2.css',
        assets: ['composes-3.module.css', 'mixins.module.scss'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes3Classes = value.composes3.split(' ');
    assert(composes3Classes[0].endsWith('_composes3'));
    assert(composes3Classes[1].endsWith('_test'));

    let css = await outputFS.readFile(path.join(distDir, 'index2.css'), 'utf8');
    assert(css.includes('height: 200px;'));
  });

  it('should support composes imports with custom path names', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index3.js'),
    );

    assertBundles(b, [
      {
        name: 'index3.js',
        assets: ['index3.js', 'composes-4.module.css', 'mixins.module.css'],
      },
      {
        name: 'index3.css',
        assets: ['composes-4.module.css', 'mixins.module.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes4Classes = value.composes4.split(' ');
    assert(composes4Classes[0].endsWith('_composes4'));
    assert(composes4Classes[1].endsWith('_test'));

    let css = await outputFS.readFile(path.join(distDir, 'index3.css'), 'utf8');
    assert(css.includes('height: 100px;'));
  });

  it('should support deep nested composes imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index4.js'),
    );

    assertBundles(b, [
      {
        name: 'index4.js',
        assets: [
          'index4.js',
          'composes-5.module.css',
          'mixins-intermediate.module.css',
          'mixins.module.css',
        ],
      },
      {
        name: 'index4.css',
        assets: [
          'composes-5.module.css',
          'mixins-intermediate.module.css',
          'mixins.module.css',
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes5Classes = value.composes5.split(' ');
    assert(composes5Classes[0].endsWith('_composes5'));
    assert(composes5Classes[1].endsWith('_intermediate'));
    assert(composes5Classes[2].endsWith('_test'));

    let css = await outputFS.readFile(path.join(distDir, 'index4.css'), 'utf8');
    assert(css.includes('height: 100px;'));
    assert(css.includes('height: 300px;'));
    assert(css.indexOf('_test') < css.indexOf('_intermediate'));
    assert(css.indexOf('_intermediate') < css.indexOf('_composes5'));
  });

  it('should support composes imports for multiple selectors', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index5.js'),
    );

    assertBundles(b, [
      {
        name: 'index5.js',
        assets: ['index5.js', 'composes-6.module.css', 'mixins.module.css'],
      },
      {
        name: 'index5.css',
        assets: ['composes-6.module.css', 'mixins.module.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes6Classes = value.composes6.split(' ');
    assert(composes6Classes[0].endsWith('_composes6'));
    assert(composes6Classes[1].endsWith('_test'));
    assert(composes6Classes[2].endsWith('_test-2'));
  });

  it('should throw an error when importing a missing class', async function () {
    await assert.rejects(
      () =>
        bundle(
          path.join(
            __dirname,
            '/integration/no-export-error-with-correct-filetype/src/App.jsx',
          ),
          {
            shouldDisableCache: true,
            defaultTargetOptions: {
              shouldScopeHoist: true,
            },
          },
        ),
      {
        name: 'BuildError',
        diagnostics: [
          {
            codeFrames: [
              {
                filePath: path.join(
                  __dirname,
                  '/integration/no-export-error-with-correct-filetype/src/App.jsx',
                ),
                language: 'js',
                codeHighlights: [
                  {
                    message: undefined,
                    end: {
                      column: 45,
                      line: 7,
                    },
                    start: {
                      column: 28,
                      line: 7,
                    },
                  },
                ],
              },
            ],
            message:
              "integration/no-export-error-with-correct-filetype/src/app.module.css does not export 'notExisting'",
            origin: '@parcel/core',
          },
        ],
      },
    );
  });

  it('should fall back to postcss for legacy css modules', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-legacy/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.module.css'],
      },
      {
        name: 'index.css',
        assets: ['index.module.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('color: red'));
  });

  it('should fall back to postcss for legacy css modules with :export', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-legacy/b.js'),
    );

    assertBundles(b, [
      {
        name: 'b.js',
        assets: ['b.js', 'b.module.css'],
      },
      {
        name: 'b.css',
        assets: ['b.module.css'],
      },
    ]);

    let res = await run(b);
    assert.deepEqual(res, {color: 'red'});
  });

  it('should optimize away unused @keyframes', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-keyframes/index.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.module.css'],
      },
      {
        name: 'index.css',
        assets: ['index.module.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(/@keyframes _[_0-9a-zA-Z]+_test/.test(css));
    assert(!css.includes('unused'));
  });

  it('should not double optimize css modules processed with postcss', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-modules-optimize/index.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.css'],
      },
      {
        name: 'index.css',
        assets: ['index.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('@keyframes test'));
    assert(css.includes('@keyframes unused'));
  });

  it('should compile css modules for multiple targets', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-targets/index.html'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['index.js', 'foo.module.css'],
      },
      {
        type: 'js',
        assets: ['index.js', 'foo.module.css'],
      },
      {
        type: 'css',
        assets: ['foo.module.css'],
      },
    ]);
  });

  it('should not fail with many css modules', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-bug/src/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: [
          'button.module.css',
          'main.js',
          'main.module.css',
          'other.module.css',
        ],
      },
      {
        type: 'css',
        assets: ['button.module.css', 'main.module.css', 'other.module.css'],
      },
    ]);
  });

  // Forked because experimental bundler will not merge bundles of same types if they do not share all their bundlegroups
  it('should handle @import in css modules', async function () {
    let b = await bundle(
      [
        path.join(__dirname, '/integration/css-modules-import/page1.html'),
        path.join(__dirname, '/integration/css-modules-import/page2.html'),
      ],
      {mode: 'production'},
    );

    let res = [];
    await runBundle(
      b,
      b.getBundles().find(b => b.name === 'page1.html'),
      {
        sideEffect: s => res.push(s),
      },
    );

    assert.deepEqual(res, [['page1', '_1ZEqVW_a']]);

    res = [];
    await runBundle(
      b,
      b.getBundles().find(b => b.name === 'page2.html'),
      {
        sideEffect: s => res.push(s),
      },
    );

    assert.deepEqual(res, [['page2', '_4fY2uG_foo _1ZEqVW_foo j1UkRG_foo']]);

    assertBundles(b, [
      {
        name: 'page1.html',
        assets: ['page1.html'],
      },
      {
        name: 'page2.html',
        assets: ['page2.html'],
      },
      {
        type: 'js',
        assets: [
          'page1.js',
          'index.module.css',
          'a.module.css',
          'b.module.css',
        ],
      },
      {
        type: 'js',
        assets: [
          'page2.js',
          'index.module.css',
          'a.module.css',
          'b.module.css',
        ],
      },
      {
        type: 'css',
        assets: ['a.module.css', 'b.module.css'],
      },
      {
        type: 'css',
        assets: ['index.module.css'],
      },
    ]);
  });

  it('should not process inline <style> elements as a CSS module', async function () {
    await bundle(
      path.join(__dirname, '/integration/css-modules-style/index.html'),
    );
    let contents = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(contents.includes('.index {'));
  });

  it('should support global css modules via boolean config', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-global/a/index.js'),
      {mode: 'production'},
    );
    let res = await run(b);
    assert.deepEqual(res, 'C-gzXq_foo');

    let contents = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    assert(contents.includes('.C-gzXq_foo'));
    assert(contents.includes('.x'));
  });

  it('should support global css modules via object config', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-global/b/index.js'),
      {mode: 'production'},
    );
    let res = await run(b);
    assert.deepEqual(res, 'C-gzXq_foo');
    let contents = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    assert(contents.includes('.C-gzXq_foo'));
    assert(contents.includes('.x'));
  });

  it('should optimize away unused variables when dashedIdents option is used', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-modules-vars/index.js'),
      {mode: 'production'},
    );
    let contents = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    assert.equal(
      contents.split('\n')[0],
      ':root{--wGsoEa_color:red;--wGsoEa_font:Helvetica;--wGsoEa_theme-sizes-1\\/12:2;--wGsoEa_from-js:purple}body{font:var(--wGsoEa_font)}._4fY2uG_foo{color:var(--wGsoEa_color);width:var(--wGsoEa_theme-sizes-1\\/12);height:var(--height)}',
    );
    let res = await run(b);
    assert.deepEqual(res, ['_4fY2uG_foo', '--wGsoEa_from-js']);
  });

  it('should group together css and css modules into one bundle', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/css-module-css-siblings/index.html'),
    );

    let res = [];
    await runBundle(
      b,
      b.getBundles().find(b => b.name === 'index.html'),
      {
        sideEffect: s => res.push(s),
      },
    );
    assert.deepEqual(res, [
      ['mainJs', '_1ZEqVW_myClass', 'j1UkRG_myOtherClass'],
    ]);
  });

  it('should bundle css modules siblings together and their JS assets', async function () {
    // This issue was first documented here
    // https://github.com/parcel-bundler/parcel/issues/8716
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/css-modules-merging-siblings/index.html',
      ),
    );
    let res = [];
    await runBundle(
      b,
      b.getBundles().find(b => b.name === 'index.html'),
      {
        sideEffect: s => res.push(s),
      },
    );
    // Result is  [ 'mainJs', 'SX8vmq_container YpGmra_-expand' ]
    assert.deepEqual(res[0][0], 'mainJs');
    assert(res[0][1].includes('container') && res[0][1].includes('expand'));
  });

  it('should allow css modules to be shared between targets', async function () {
    let b = await bundle([
      path.join(__dirname, '/integration/css-module-self-references/a'),
      path.join(__dirname, '/integration/css-module-self-references/b'),
    ]);

    assertBundles(b, [
      {
        name: 'main.css',
        assets: ['bar.module.css'],
      },
      {
        name: 'main.css',
        assets: ['bar.module.css'],
      },
      {
        name: 'main.js',
        assets: ['index.js', 'bar.module.css'],
      },
      {
        name: 'main.js',
        assets: ['index.js', 'bar.module.css'],
      },
      {
        name: 'module.js',
        assets: ['index.js', 'bar.module.css'],
      },
      {
        name: 'module.js',
        assets: ['index.js', 'bar.module.css'],
      },
    ]);
  });

  it('should support the "include" and "exclude" options', async function () {
    await fsFixture(overlayFS, __dirname)`
      css-module-include
        a.css:
          .foo { color: red }
        modules/b.css:
          .bar { color: yellow }
        modules/_c.css:
          .baz { color: pink }
        index.js:
          import './a.css';
          import {bar} from './modules/b.css';
          import './modules/_c.css';
          export default bar;

        package.json:
          {
            "@parcel/transformer-css": {
              "cssModules": {
                "include": "modules/*.css",
                "exclude": "modules/_*.css"
              }
            }
          }

        yarn.lock:`;

    let b = await bundle(path.join(__dirname, 'css-module-include/index.js'), {
      mode: 'production',
      inputFS: overlayFS,
    });

    let contents = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'css').filePath,
      'utf8',
    );
    assert(contents.includes('.foo'));
    assert(contents.includes('.rp85ja_bar'));
    assert(contents.includes('.baz'));
  });
});
