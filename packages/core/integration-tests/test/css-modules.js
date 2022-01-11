import assert from 'assert';
import path from 'path';
import {
  bundle as originalBundle,
  run,
  assertBundles,
  distDir,
  outputFS,
} from '@parcel/test-utils';
import postcss from 'postcss';

describe('css modules', () => {
  for (let name of ['old', 'new']) {
    describe(name, () => {
      let bundle = (entries, opts = {}) => {
        if (name === 'new') {
          // $FlowFixMe
          opts.defaultConfig =
            path.dirname(require.resolve('@parcel/test-utils')) +
            '/.parcelrc-css';
        }
        return originalBundle(entries, opts);
      };

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
        assert(/foo_[0-9a-zA-Z]/.test(value));

        let cssClass = value.match(/(foo_[0-9a-zA-Z])/)[1];

        let css = await outputFS.readFile(
          path.join(distDir, 'index.css'),
          'utf8',
        );
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
        assert(/b-2_[0-9a-zA-Z]/.test(output));

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
        assert(/b-2_[0-9a-zA-Z]/.test(output));

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
        assert(/b-2_[0-9a-zA-Z]/.test(output));

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
        assert(/b-2_[0-9a-zA-Z]/.test(output['b-2']));
        assert(/unused_[0-9a-zA-Z]/.test(output['unused']));

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
          new Set([
            'body',
            `.${output['b-2']}`,
            `.${output['unused']}`,
            '.page',
          ]),
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
        assert(composes1Classes[0].startsWith('composes1_'));
        assert(composes1Classes[1].startsWith('test_'));
        assert(composes2Classes[0].startsWith('composes2_'));
        assert(composes2Classes[1].startsWith('test_'));

        let css = await outputFS.readFile(
          path.join(distDir, 'index.css'),
          'utf8',
        );
        let cssClass1 = value.composes1.match(/(composes1_[0-9a-zA-Z]+)/)[1];
        assert(css.includes(`.${cssClass1}`));
        let cssClass2 = value.composes2.match(/(composes2_[0-9a-zA-Z]+)/)[1];
        assert(css.includes(`.${cssClass2}`));
      });

      it('should not include css twice for composes imports', async () => {
        let b = await bundle(
          path.join(__dirname, '/integration/postcss-composes/index.js'),
        );

        await run(b);

        let css = await outputFS.readFile(
          path.join(distDir, 'index.css'),
          'utf8',
        );
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
            assets: [
              'index2.js',
              'composes-3.module.css',
              'mixins.module.scss',
            ],
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
        assert(composes3Classes[0].startsWith('composes3_'));
        assert(composes3Classes[1].startsWith('test_'));

        let css = await outputFS.readFile(
          path.join(distDir, 'index2.css'),
          'utf8',
        );
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
        assert(composes4Classes[0].startsWith('composes4_'));
        assert(composes4Classes[1].startsWith('test_'));

        let css = await outputFS.readFile(
          path.join(distDir, 'index3.css'),
          'utf8',
        );
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
        assert(composes5Classes[0].startsWith('composes5_'));
        assert(composes5Classes[1].startsWith('intermediate_'));
        assert(composes5Classes[2].startsWith('test_'));

        let css = await outputFS.readFile(
          path.join(distDir, 'index4.css'),
          'utf8',
        );
        assert(css.includes('height: 100px;'));
        assert(css.includes('height: 300px;'));
        assert(css.indexOf('.test_') < css.indexOf('.intermediate_'));
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
        assert(composes6Classes[0].startsWith('composes6_'));
        assert(composes6Classes[1].startsWith('test_'));
        assert(composes6Classes[2].startsWith('test-2_'));
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

        let css = await outputFS.readFile(
          path.join(distDir, 'index.css'),
          'utf8',
        );
        assert(css.includes('color: red'));
      });
    });
  }
});
