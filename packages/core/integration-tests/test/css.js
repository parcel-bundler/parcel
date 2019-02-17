const assert = require('assert');
const path = require('path');
const fs = require('@parcel/fs');
const {
  bundle,
  run,
  assertBundleTree,
  rimraf,
  ncp
} = require('@parcel/test-utils');

describe('css', function() {
  it('should produce two bundles when importing a CSS file', async function() {
    let b = await bundle(path.join(__dirname, '/integration/css/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'local.js', 'local.css'],
      childBundles: [
        {
          name: 'index.js.map'
        },
        {
          name: 'index.css',
          assets: ['index.css', 'local.css'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support loading a CSS bundle along side dynamic imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-css/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'index.css',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js',
        'css-loader.js'
      ],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'map'
        },
        {
          type: 'js',
          assets: ['local.js', 'local.css'],
          childBundles: [
            {
              type: 'css',
              assets: ['local.css'],
              childBundles: []
            },
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should support importing CSS from a CSS file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/css-import/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'other.css', 'local.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css', 'other.css', 'local.css'],
          childBundles: []
        },
        {
          name: 'index.js.map',
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(/@media print {\s*.other/.test(css));
    assert(css.includes('.index'));
  });

  it('should support linking to assets with url() from CSS', async function() {
    let b = await bundle(path.join(__dirname, '/integration/css-url/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'map'
        },
        {
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(/url\("test\.[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));
    assert(css.includes('url("data:image/gif;base64,quotes")'));
    assert(css.includes('.quotes'));
    assert(css.includes('url(data:image/gif;base64,no-quote)'));
    assert(css.includes('.no-quote'));

    assert(
      await fs.exists(
        path.join(
          __dirname,
          '/dist/',
          css.match(/url\("(test\.[0-9a-f]+\.woff2)"\)/)[1]
        )
      )
    );
  });

  it('should support linking to assets with url() from CSS in production', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/css-url/index.js'),
      {
        production: true
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'map'
        },
        {
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(/url\(test\.[0-9a-f]+\.woff2\)/.test(css), 'woff ext found in css');
    assert(css.includes('url(http://google.com)'), 'url() found');
    assert(css.includes('.index'), '.index found');
    assert(css.includes('url("data:image/gif;base64,quotes")'));
    assert(css.includes('.quotes'));
    assert(css.includes('url(data:image/gif;base64,no-quote)'));
    assert(css.includes('.no-quote'));

    assert(
      await fs.exists(
        path.join(
          __dirname,
          '/dist/',
          css.match(/url\((test\.[0-9a-f]+\.woff2)\)/)[1]
        )
      )
    );
  });

  it('should support linking to assets in parent folders with url() from CSS', async function() {
    let b = await bundle(
      [
        path.join(__dirname, '/integration/css-url-relative/src/a/style1.css'),
        path.join(__dirname, '/integration/css-url-relative/src/b/style2.css')
      ],
      {
        production: true,
        sourceMaps: false
      }
    );

    await assertBundleTree(b, [
      {
        type: 'css',
        assets: ['style1.css'],
        childBundles: [
          {
            type: 'png'
          }
        ]
      },
      {
        type: 'css',
        assets: ['style2.css']
      }
    ]);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/a/style1.css'),
      'utf8'
    );

    assert(css.includes('background-image'), 'includes `background-image`');
    assert(/url\([^)]*\)/.test(css), 'includes url()');

    assert(
      await fs.exists(
        path.join(
          __dirname,
          path.dirname('/dist/a/style1.css'),
          css.match(/url\(([^)]*)\)/)[1]
        )
      ),
      'path specified in url() exists'
    );
  });

  it('should support transforming with postcss', async function() {
    let b = await bundle(path.join(__dirname, '/integration/postcss/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert(/_index_[0-9a-z]/.test(value));

    let cssClass = value.match(/(_index_[0-9a-z]+)/)[1];

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes(`.${cssClass}`));
  });

  it('should support transforming with postcss twice with the same result', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-plugins/index.js')
    );
    let c = await bundle(
      path.join(__dirname, '/integration/postcss-plugins/index2.js')
    );

    let [run1, run2] = await Promise.all([await run(b), await run(c)]);

    assert.equal(run1(), run2());
  });

  it('should support postcss composes imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'composes-1.css', 'composes-2.css', 'mixins.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['composes-1.css', 'composes-2.css', 'mixins.css'],
          childBundles: []
        },
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert.equal(value.composes1, '_composes1_29315 _test_19e21');
    assert.equal(value.composes2, '_composes2_b5878 _test_19e21');

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    let cssClass1 = value.composes1.match(/(_composes1_[0-9a-z]+)/)[1];
    assert(css.includes(`.${cssClass1}`));
    let cssClass2 = value.composes2.match(/(_composes2_[0-9a-z]+)/)[1];
    assert(css.includes(`.${cssClass2}`));
  });

  it('should not include css twice for postcss composes imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index.js')
    );

    await run(b);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert.equal(
      css.indexOf('height: 100px;'),
      css.lastIndexOf('height: 100px;')
    );
  });

  it('should support postcss composes imports for sass', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index2.js')
    );

    await assertBundleTree(b, {
      name: 'index2.js',
      assets: ['index2.js', 'composes-3.css', 'mixins.scss'],
      childBundles: [
        {
          name: 'index2.css',
          assets: ['composes-3.css', 'mixins.scss'],
          childBundles: []
        },
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert.equal(value.composes3, '_composes3_6834d _test_c0a12');

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index2.css'),
      'utf8'
    );
    assert(css.includes('height: 200px;'));
  });

  it('should support postcss composes imports with custom path names', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index3.js')
    );

    await assertBundleTree(b, {
      name: 'index3.js',
      assets: ['index3.js', 'composes-4.css', 'mixins.css'],
      childBundles: [
        {
          name: 'index3.css',
          assets: ['composes-4.css', 'mixins.css'],
          childBundles: []
        },
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert.equal(value.composes4, '_composes4_7038c _test_19e21');

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index3.css'),
      'utf8'
    );
    assert(css.includes('height: 100px;'));
  });

  it('should minify CSS in production mode', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/cssnano/index.js'),
      {
        production: true
      }
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.local'));
    assert(css.includes('.index'));
    assert(!css.includes('\n'));
  });

  it('should automatically install postcss plugins with npm if needed', async function() {
    await rimraf(path.join(__dirname, '/input'));
    await ncp(
      path.join(__dirname, '/integration/autoinstall/npm'),
      path.join(__dirname, '/input')
    );
    await bundle(path.join(__dirname, '/input/index.css'));

    // cssnext was installed
    let pkg = require('./input/package.json');
    assert(pkg.devDependencies['postcss-cssnext']);

    // peer dependency caniuse-lite was installed
    assert(pkg.devDependencies['caniuse-lite']);

    // cssnext is applied
    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('rgba'));
  });

  it('should automatically install postcss plugins with yarn if needed', async function() {
    await rimraf(path.join(__dirname, '/input'));
    await ncp(
      path.join(__dirname, '/integration/autoinstall/yarn'),
      path.join(__dirname, '/input')
    );
    await bundle(path.join(__dirname, '/input/index.css'));

    // cssnext was installed
    let pkg = require('./input/package.json');
    assert(pkg.devDependencies['postcss-cssnext']);

    // peer dependency caniuse-lite was installed
    assert(pkg.devDependencies['caniuse-lite']);

    // appveyor is not currently writing to the yarn.lock file and will require further investigation
    // let lockfile = await fs.readFile(path.join(__dirname, '/input/yarn.lock'), 'utf8');
    // assert(lockfile.includes('postcss-cssnext'));

    // cssnext is applied
    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('rgba'));
  });
});
