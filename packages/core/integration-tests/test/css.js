import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  distDir,
  removeDistDirectory,
  outputFS,
} from '@parcel/test-utils';

describe('css', () => {
  afterEach(async () => {
    await removeDistDirectory();
  });

  it('should produce two bundles when importing a CSS file', async () => {
    let b = await bundle(path.join(__dirname, '/integration/css/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.js'],
      },
      {
        name: 'index.css',
        assets: ['index.css', 'local.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should bundle css dependencies in the correct, postorder traversal order', async () => {
    let b = await bundle(path.join(__dirname, '/integration/css-order/a.css'));

    // Given a tree of css with imports:
    //      A
    //    /   \
    //   B     E
    //  / \
    // C   D
    //
    // (A imports B (which imports C and D) and E)
    //
    // ...styles should be applied in the order C, D, B, E, A

    assertBundles(b, [
      {
        name: 'a.css',
        assets: ['a.css', 'b.css', 'c.css', 'd.css', 'e.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'a.css'), 'utf8');
    assert.ok(
      css.indexOf('.c {') < css.indexOf('.d {') &&
        css.indexOf('.d {') < css.indexOf('.b {') &&
        css.indexOf('.b {') < css.indexOf('.e {') &&
        css.indexOf('.e {') < css.indexOf('.a {'),
    );
  });

  it('should support loading a CSS bundle along side dynamic imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-css/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'index.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {name: /local\.[0-9a-f]+\.js/, assets: ['local.js']},
      {name: /local\.[0-9a-f]+\.css/, assets: ['local.css']},
      {name: 'index.css', assets: ['index.css']},
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should support importing CSS from a CSS file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/css-import/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.css', 'other.css', 'local.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, '/index.css'), 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(/@media print {\s*.other/.test(css));
    assert(css.includes('.index'));
  });

  it('should support linking to assets with url() from CSS', async function() {
    let b = await bundle(path.join(__dirname, '/integration/css-url/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.css'],
      },
      {
        type: 'woff2',
        assets: ['test.woff2'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(/url\("test\.[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));
    assert(css.includes('url("data:image/gif;base64,quotes")'));
    assert(css.includes('.quotes'));
    assert(css.includes('url(data:image/gif;base64,no-quote)'));
    assert(css.includes('.no-quote'));

    assert(
      await outputFS.exists(
        path.join(distDir, css.match(/url\("(test\.[0-9a-f]+\.woff2)"\)/)[1]),
      ),
    );
  });

  it('should support linking to assets with url() from CSS in production', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/css-url/index.js'),
      {
        minify: true,
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.css'],
      },
      {
        type: 'woff2',
        assets: ['test.woff2'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(/url\(test\.[0-9a-f]+\.woff2\)/.test(css), 'woff ext found in css');
    assert(css.includes('url(http://google.com)'), 'url() found');
    assert(css.includes('.index'), '.index found');
    assert(css.includes('url("data:image/gif;base64,quotes")'));
    assert(css.includes('.quotes'));
    assert(css.includes('url(data:image/gif;base64,no-quote)'));
    assert(css.includes('.no-quote'));

    assert(
      await outputFS.exists(
        path.join(distDir, css.match(/url\((test\.[0-9a-f]+\.woff2)\)/)[1]),
      ),
    );
  });

  it('should support linking to assets in parent folders with url() from CSS', async function() {
    let b = await bundle(
      [
        path.join(__dirname, '/integration/css-url-relative/src/a/style1.css'),
        path.join(__dirname, '/integration/css-url-relative/src/b/style2.css'),
      ],
      {
        minify: true,
        sourceMaps: false,
      },
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['style1.css'],
      },
      {
        type: 'css',
        assets: ['style2.css'],
      },
      {
        type: 'png',
        assets: ['foo.png'],
      },
    ]);

    let cssPath = path.join(distDir, 'a', 'style1.css');
    let css = await outputFS.readFile(cssPath, 'utf8');

    assert(css.includes('background-image'), 'includes `background-image`');
    assert(/url\([^)]*\)/.test(css), 'includes url()');

    assert(
      await outputFS.exists(
        path.resolve(path.dirname(cssPath), css.match(/url\(([^)]*)\)/)[1]),
      ),
      'path specified in url() exists',
    );
  });

  it('should ignore url() with IE behavior specifiers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/css-url-behavior/index.css'),
    );

    assertBundles(b, [
      {
        name: 'index.css',
        assets: ['index.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');

    assert(css.includes('url(#default#VML)'));
  });

  it('should minify CSS when minify is set', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/cssnano/index.js'),
      {
        minify: true,
        sourceMaps: false,
      },
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.index'));

    assert.equal(css.split('\n').length, 1);
  });

  it('should produce a sourcemap when sourceMaps are used', async function() {
    await bundle(path.join(__dirname, '/integration/cssnano/index.js'), {
      minify: true,
    });

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.index'));

    let lines = css.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1], '/*# sourceMappingURL=index.css.map */');

    let map = JSON.parse(
      await outputFS.readFile(path.join(distDir, 'index.css.map'), 'utf8'),
    );
    assert.equal(map.file, 'index.css.map');
    assert.equal(map.mappings, 'AAAA,OACA,WACA,CCFA,OACA,SACA');
    assert.deepEqual(map.sources, [
      './integration/cssnano/local.css',
      './integration/cssnano/index.css',
    ]);
  });

  it('should inline data-urls for text-encoded files', async () => {
    await bundle(path.join(__dirname, '/integration/data-url/text.css'), {
      sourceMaps: false,
    });
    let css = await outputFS.readFile(path.join(distDir, 'text.css'), 'utf8');
    assert.equal(
      css.trim(),
      `.svg-img {
  background-image: url('data:image/svg+xml,%3Csvg%20width%3D%22120%22%20height%3D%27120%27%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%20%20%3Cfilter%20id%3D%22blur-_.%21~%2a%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%225%22%2F%3E%0A%20%20%3C%2Ffilter%3E%0A%20%20%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2250%22%20fill%3D%22green%22%20filter%3D%22url%28%23blur-_.%21~%2a%29%22%20%2F%3E%0A%3C%2Fsvg%3E%0A');
}`,
    );
  });

  it('should inline data-urls for binary files', async () => {
    await bundle(path.join(__dirname, '/integration/data-url/binary.css'));
    let css = await outputFS.readFile(path.join(distDir, 'binary.css'), 'utf8');
    assert(
      css.startsWith(`.webp-img {
  background-image: url('data:image/webp;base64,UklGR`),
    );
  });
});
