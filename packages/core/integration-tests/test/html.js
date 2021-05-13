import assert from 'assert';
import {
  bundle,
  bundler,
  assertBundles,
  removeDistDirectory,
  distDir,
  getNextBuild,
  run,
  inputFS,
  outputFS,
  overlayFS,
  ncp,
} from '@parcel/test-utils';
import path from 'path';

describe('html', function() {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  let subscription;
  afterEach(async () => {
    if (subscription) {
      await subscription.unsubscribe();
      subscription = null;
    }
  });

  it('should support bundling HTML', async () => {
    let b = await bundle(path.join(__dirname, '/integration/html/index.html'));

    assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'png',
        assets: ['100x100.png'],
      },
      {
        type: 'svg',
        assets: ['icons.svg'],
      },
      {
        type: 'css',
        assets: ['index.css'],
      },
      {
        type: 'html',
        assets: ['other.html'],
      },
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    let files = await outputFS.readdir(distDir);
    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    for (let file of files) {
      if (file !== 'index.html' && path.extname(file) !== '.map') {
        assert(html.includes(file));
      }
    }

    let value = null;
    await run(b, {
      alert: v => (value = v),
    });
    assert.equal(value, 'Hi');
  });

  it('should support pkg#source array as entrypoints', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/html-pkg-source-array'),
    );

    assertBundles(b, [
      {
        name: 'a.html',
        assets: ['a.html'],
      },
      {
        name: 'b.html',
        assets: ['b.html'],
      },
    ]);

    assert(
      await outputFS.exists(
        path.join(distDir, 'html-pkg-source-array/a.html'),
        'utf8',
      ),
    );
    assert(
      await outputFS.exists(
        path.join(distDir, 'html-pkg-source-array/b.html'),
        'utf8',
      ),
    );
  });

  it('should find href attr when not first', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-attr-order/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'html',
        assets: ['other.html'],
      },
    ]);
  });

  it('should insert empty script tag for HMR', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-no-js/index.html'),
      {
        hmrOptions: {},
      },
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['HMRRuntime.js', 'index.html'],
      },
    ]);
  });

  it('should support canonical links', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-canonical/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    assert(/<link rel="canonical" href="\.?\/index.html">/.test(html));
  });

  it('should support meta tag with none content', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-meta/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(/<meta name="msapplication-config" content="none">/.test(html));
  });

  it('should insert sibling CSS bundles for JS files in the HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css/index.html'),
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
        type: 'css',
        assets: ['index.css'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(
      /<link rel="stylesheet" href="[/\\]{1}index\.[a-f0-9]+\.css">/.test(html),
    );
  });

  it('should insert sibling bundles before body element if no HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-head/index.html'),
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
        type: 'css',
        assets: ['index.css'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(
      /<html>\s*<link rel="stylesheet" href="[/\\]{1}index\.[a-f0-9]+\.css">\s*<body>/.test(
        html,
      ),
    );
  });

  it('should insert sibling bundles after doctype if no html', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-doctype/index.html'),
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
        type: 'css',
        assets: ['index.css'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(
      /^\s*<!DOCTYPE html>\s*<link .*>\s*<script .*>\s*<\/script>\s*$/.test(
        html,
      ),
    );
  });

  it.skip('should insert sibling JS bundles for CSS files in the HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-js/index.html'),
      {
        hmr: true,
      },
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.css'],
      },
      {
        type: 'js',
        assets: [
          'index.css',
          'bundle-url.js',
          'css-loader.js',
          'hmr-runtime.js',
        ],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(/<script src="[/\\]{1}index\.[a-f0-9]+\.js">/.test(html));
  });

  it('should insert sibling bundles at correct location in tree when optional elements are absent', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/html-css-optional-elements/index.html',
      ),
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
        type: 'css',
        assets: ['index.css'],
      },
      {
        type: 'js',
        assets: ['other.js'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    assert(
      /^<link rel="stylesheet" href="[/\\]index\.[a-f0-9]+\.css">\s*<script src="[/\\]index\.[a-f0-9]+\.js"><\/script>\s*<h1>Hello/m.test(
        html,
      ),
    );
  });

  it('should combine sibling CSS from multiple script tags into one bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-multi/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['a.js'],
      },
      {
        type: 'js',
        assets: ['b.js'],
      },
      {
        type: 'css',
        assets: ['a.css', 'b.css'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    assert.equal(
      html.match(
        /<link rel="stylesheet" href="[/\\]{1}index\.[a-f0-9]+?\.css">/g,
      ).length,
      1,
    );

    assert.equal(
      html.match(/<script src="[/\\]{1}index\.[a-f0-9]+?\.js">/g).length,
      2,
    );
  });

  it('should deduplicate shared code between script tags', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-js-dedup/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['component-1.js', 'obj.js', 'esmodule-helpers.js'],
      },
      {
        type: 'js',
        assets: ['component-2.js'],
      },
    ]);

    let o = [];
    await run(b, {
      output: v => o.push(v),
    });

    assert.deepEqual(o, ['component-1', 'component-2']);
  });

  it('should minify HTML in production mode', async function() {
    let inputFile = path.join(__dirname, '/integration/htmlnano/index.html');
    await bundle(inputFile, {
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    let inputSize = (await inputFS.stat(inputFile)).size;

    let outputFile = path.join(distDir, 'index.html');
    let outputSize = (await outputFS.stat(outputFile)).size;

    assert(inputSize > outputSize);

    let html = await outputFS.readFile(outputFile, 'utf8');
    assert(html.includes('Other page'));
  });

  it('should work with an empty html file', async function() {
    let inputFile = path.join(__dirname, '/integration/html-empty/index.html');
    await bundle(inputFile, {
      defaultTargetOptions: {
        shouldOptimize: false,
      },
    });

    let outputFile = path.join(distDir, 'index.html');
    let html = await outputFS.readFile(outputFile, 'utf8');
    assert.equal(html.length, 0);
  });

  it('should read .htmlnanorc and minify HTML in production mode', async function() {
    await bundle(
      path.join(__dirname, '/integration/htmlnano-config/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    // minifyJson
    assert(
      html.includes('<script type="application/json">{"user":"me"}</script>'),
    );

    // mergeStyles
    assert(
      html.includes(
        '<style>h1{color:red}div{font-size:20px}</style><style media="print">div{color:#00f}</style>',
      ),
    );

    assert(!html.includes('sourceMappingURL'));

    // minifySvg is false
    assert(
      html.includes(
        '<svg version="1.1" baseprofile="full" width="300" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="red"></rect><circle cx="150" cy="100" r="80" fill="green"></circle><text x="150" y="125" font-size="60" text-anchor="middle" fill="white">SVG</text></svg>',
      ),
    );
  });

  it('should not minify default values inside HTML in production mode', async function() {
    let inputFile = path.join(
      __dirname,
      '/integration/htmlnano-defaults-form/index.html',
    );
    await bundle(inputFile, {
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    let inputSize = (await inputFS.stat(inputFile)).size;

    let outputFile = path.join(distDir, '/index.html');
    let outputSize = (await outputFS.stat(outputFile)).size;

    assert(inputSize > outputSize);

    let html = await outputFS.readFile(outputFile, 'utf8');
    assert(html.includes('<input type="text">'));
  });

  it('should not prepend the public path to assets with remote URLs', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(
      html.includes('<script src="https://unpkg.com/parcel-bundler"></script>'),
    );
  });

  it('should not prepend the public path to hash links', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('<a href="#hash_link">'));
  });

  it('should detect virtual paths', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-virtualpath/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'html',
        assets: ['other.html'],
      },
    ]);
  });

  it('should not update root/main file in the bundles', async function() {
    await bundle(path.join(__dirname, '/integration/html-root/index.html'));

    let files = await outputFS.readdir(distDir);

    for (let file of files) {
      if (file !== 'index.html' && file.endsWith('.html')) {
        let html = await outputFS.readFile(path.join(distDir, file), 'utf8');
        assert(html.includes('index.html'));
      }
    }
  });

  it('should preserve the spacing in the HTML tags', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(/<i>hello<\/i> <i>world<\/i>/.test(html));
  });

  it('should support child bundles of different types', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/child-bundle-different-types/index.html',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['main.js', 'util.js', 'other.js'],
      },
      {
        type: 'html',
        assets: ['other.html'],
      },
      {
        type: 'js',
        assets: ['index.js', 'util.js', 'other.js'],
      },
    ]);
  });

  it.skip('should support circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/circular/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'html',
        assets: ['about.html'],
      },
      {
        type: 'js',
        assets: ['about.js', 'index.js'],
      },
      {
        type: 'html',
        assets: ['test.html'],
      },
      {
        type: 'js',
        assets: ['about.js', 'index.js'],
      },
    ]);
  });

  it('should support bundling HTM', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/htm-extension/index.htm'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.htm'],
        type: 'html',
      },
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);
  });

  it('should detect srcset attribute', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-srcset/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'png',
        assets: ['100x100.png'],
      },
      {
        type: 'png',
        assets: ['200x200.png'],
      },
      {
        type: 'png',
        assets: ['300x300.png'],
      },
    ]);
  });

  it('should detect srcset attribute of source element', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-source-srcset/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'png',
        assets: ['100x100.png'],
      },
      {
        type: 'png',
        assets: ['200x200.png'],
      },
      {
        type: 'png',
        assets: ['300x300.png'],
      },
    ]);
  });

  it('should detect imagesrcset attribute', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-imagesrcset/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'png',
        assets: ['100x100.png'],
      },
      {
        type: 'png',
        assets: ['200x200.png'],
      },
      {
        type: 'png',
        assets: ['300x300.png'],
      },
    ]);
  });

  it.skip('should support webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webmanifest/index.html'),
    );

    assertBundles(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'webmanifest',
          assets: ['manifest.webmanifest'],
          childBundles: [
            {
              type: 'txt',
              assets: ['some.txt'],
              childBundles: [],
            },
          ],
        },
      ],
    });
  });

  it.skip("should treat webmanifest as an entry module so it doesn't get content hashed", async function() {
    const b = await bundle(
      path.join(__dirname, '/integration/html-manifest/index.html'),
    );

    assertBundles(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'webmanifest',
          assets: ['manifest.webmanifest'],
        },
      ],
    });

    const html = await outputFS.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8',
    );
    assert(html.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  });

  it('should bundle svg files correctly', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'svg',
        assets: ['file.svg'],
      },
    ]);
  });

  it('should ignore svgs referencing local symbols via <use xlink:href="#">', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg-local-symbol/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);
  });

  it('should bundle svg files using <image xlink:href=""> correctly', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg-image/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'svg',
        assets: ['file.svg'],
      },
    ]);
  });

  // Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Element/script
  it('should bundle scripts inside svg', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg-script/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['script-a.js'],
      },
      {
        type: 'js',
        assets: ['script-b.js'],
      },
    ]);
  });

  it('should support data attribute of object element', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-object/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'svg',
        assets: ['file.svg'],
      },
    ]);
  });

  it('should resolve assets containing spaces', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-spaces/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'html',
        assets: ['other page.html'],
      },
    ]);
  });

  it('should process inline JS', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    // inline bundles are not output, but are apart of the bundleGraph
    assertBundles(b, [
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {name: 'index.html', assets: ['index.html']},
    ]);

    let files = await outputFS.readdir(distDir);
    // assert that the inline js files are not output
    assert(!files.some(filename => filename.includes('js')));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf-8',
    );

    assert(!html.includes('someArgument'));
  });

  it('should process inline styles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-styles/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        type: 'jpg',
        assets: ['bg.jpg'],
      },
      {
        type: 'jpg',
        assets: ['img.jpg'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let bundles = b.getBundles();

    let html = await outputFS.readFile(
      bundles.find(bundle => bundle.type === 'html').filePath,
      'utf8',
    );

    let urls = [...html.matchAll(/url\(([^)]*)\)/g)].map(m => m[1]);
    assert.strictEqual(urls.length, 2);
    for (let url of urls) {
      assert(
        bundles.find(
          bundle => !bundle.isInline && path.basename(bundle.filePath) === url,
        ),
      );
    }
  });

  it('should process inline element styles', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/html-inline-styles-element/index.html',
      ),
      {shouldDisableCache: false},
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);
  });

  it('should process inline styles using lang', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-sass/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('<style>.index{color:#00f}</style>'));
    assert(!html.includes('sourceMappingURL'));
  });

  it('should process inline non-js scripts', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-coffeescript/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.html'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('alert("Hello, World!")'));
  });

  it('should handle inline css with @imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-css-import/index.html'),
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html', 'test.css'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(!html.includes('@import'));
  });

  it('should not modify inline importmaps', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-importmap/index.html'),
      {},
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(html.includes('/node_modules/lit1.3.0/'));
  });

  it('should allow imports and requires in inline <script> tags', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js-require/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.html', 'test.js'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('console.log("test")'));
  });

  it('should support protocol-relative urls', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-protocol-relative/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['index.css'],
      },
    ]);

    for (let bundle of b.getBundles()) {
      let contents = await outputFS.readFile(bundle.filePath, 'utf8');
      assert(contents.includes('//unpkg.com/xyz'));
    }
  });

  it('should support inline <script type="module">', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js-module/index.html'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.html'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('<script type="module">'));
    assert(html.includes('document.write("Hello world")'));
  });

  it('should correctly bundle loaders for nested dynamic imports', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/html-js-shared-dynamic-nested/index.html',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'index.js',
          'index.js',
          'index.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['simpleHasher.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, ['hasher', ['hasher', 'hasher']]);
  });

  it('should support shared bundles between multiple inline scripts', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js-shared/index.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: false,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['lodash.js'],
      },
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('<script type="module" src="'));
    assert(html.includes('<script type="module">'));
    assert(html.includes('.add(1, 2)'));
    assert(html.includes('.add(2, 3)'));
  });

  it('inserts sibling bundles into html in the correct order (no head)', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-js-shared/index.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['async.js'],
      },
      {
        type: 'js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'get-worker-url.js',
          'index.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        name: 'index.html',
        type: 'html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['lodash.js'],
      },
      {
        type: 'js',
        assets: ['worker.js'],
      },
    ]);

    let lodashSibling = path.basename(
      b.getBundles().find(v => v.getEntryAssets().length === 0).filePath,
    );

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    let insertedBundles = [];
    let regex = /<script (?:type="[^"]+" )?src="([^"]*)"><\/script>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      insertedBundles.push(path.basename(match[1]));
    }

    assert.equal(insertedBundles.length, 2);
    assert.equal(insertedBundles[0], lodashSibling);
  });

  it('inserts sibling bundles into html in the correct order (head)', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-js-shared-head/index.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['async.js'],
      },
      {
        type: 'js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'get-worker-url.js',
          'index.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        name: 'index.html',
        type: 'html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['lodash.js'],
      },
      {
        type: 'js',
        assets: ['worker.js'],
      },
    ]);

    let lodashSibling = path.basename(
      b.getBundles().find(v => v.getEntryAssets().length === 0).filePath,
    );

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    let insertedBundles = [];
    let regex = /<script (?:type="[^"]+" )?src="([^"]*)"><\/script>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      insertedBundles.push(path.basename(match[1]));
    }

    assert.equal(insertedBundles.length, 2);
    assert.equal(insertedBundles[0], lodashSibling);
  });

  it('should support multiple entries with shared sibling bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-sibling-entries/*.html'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'a.html',
        type: 'html',
        assets: ['a.html'],
      },
      {
        name: 'b.html',
        type: 'html',
        assets: ['b.html'],
      },
      {
        name: 'c.html',
        type: 'html',
        assets: ['c.html'],
      },
      {
        type: 'js',
        assets: ['a.html', 'shared.js'],
      },
      {
        type: 'js',
        assets: ['b.html', 'shared.js'],
      },
      {
        type: 'js',
        assets: ['c.html', 'shared.js'],
      },
      {
        type: 'css',
        assets: ['shared.css', 'other.css'],
      },
    ]);

    // Both HTML files should point to the sibling CSS file
    let html = await outputFS.readFile(path.join(distDir, 'a.html'), 'utf8');
    assert(/<link rel="stylesheet" href="\/a\.[a-z0-9]+\.css">/.test(html));

    html = await outputFS.readFile(path.join(distDir, 'b.html'), 'utf8');
    assert(/<link rel="stylesheet" href="\/a\.[a-z0-9]+\.css">/.test(html));

    html = await outputFS.readFile(path.join(distDir, 'c.html'), 'utf8');
    assert(/<link rel="stylesheet" href="\/a\.[a-z0-9]+\.css">/.test(html));
  });

  it('should insert JS sibling bundle script tags in the correct order', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/scope-hoisting/es6/interop-async/index.html',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: false,
        },
      },
    );
    let bundles = b.getBundles();

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    let insertedBundles = [];
    let regex = /<script (?:type="[^"]+" )?src="([^"]*)"><\/script>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      let bundle = bundles.find(
        b => path.basename(b.filePath) === path.basename(match[1]),
      );

      insertedBundles.push(bundle);
    }

    assert.equal(insertedBundles.length, 1);

    let output = await run(b);
    assert.deepEqual(output, ['client', 'client', 'viewer']);
  });

  it('should not point to unrelated sibling bundles', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/shared-sibling-entries-multiple/*.html',
      ),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    // a.html should point to a CSS bundle containing a.css as well as
    // reuse the b.css bundle from b.html.
    let html = await outputFS.readFile(path.join(distDir, 'a.html'), 'utf8');
    assert.equal(
      html.match(/<link rel="stylesheet" href="\/a\.[a-z0-9]+\.css">/g).length,
      1,
    );
    assert.equal(
      html.match(/<link rel="stylesheet" href="\/b\.[a-z0-9]+\.css">/g).length,
      1,
    );

    // a.html should reference a.js only
    assert.equal(html.match(/a\.[a-z0-9]+\.js/g).length, 1);

    assert.equal(html.match(/b\.[a-z0-9]+\.js/g), null);

    let css = await outputFS.readFile(
      path.join(distDir, html.match(/\/a\.[a-z0-9]+\.css/)[0]),
      'utf8',
    );
    assert(css.includes('.a {'));
    assert(!css.includes('.b {'));

    // b.html should point to a CSS bundle containing only b.css
    // It should not point to the bundle containing a.css from a.html
    html = await outputFS.readFile(path.join(distDir, 'b.html'), 'utf8');
    assert.equal(
      html.match(/<link rel="stylesheet" href="\/a\.[a-z0-9]+\.css">/g),
      null,
    );
    assert.equal(
      html.match(/<link rel="stylesheet" href="\/b\.[a-z0-9]+\.css">/g).length,
      1,
    );

    // b.html should reference b.js only
    assert.equal(html.match(/a\.[a-z0-9]+\.js/g), null);

    assert.equal(html.match(/b\.[a-z0-9]+\.js/g).length, 1);

    css = await outputFS.readFile(
      path.join(distDir, html.match(/\/b\.[a-z0-9]+\.css/)[0]),
      'utf8',
    );
    assert(!css.includes('.a {'));
    assert(css.includes('.b {'));
  });

  it('should support split bundles with many pages', async function() {
    await bundle(path.join(__dirname, '/integration/shared-many/*.html'), {
      mode: 'production',
    });

    let html = await outputFS.readFile(path.join(distDir, 'a.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 2);

    html = await outputFS.readFile(path.join(distDir, 'b.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 4);

    html = await outputFS.readFile(path.join(distDir, 'c.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 3);

    html = await outputFS.readFile(path.join(distDir, 'd.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 2);

    html = await outputFS.readFile(path.join(distDir, 'e.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 1);

    html = await outputFS.readFile(path.join(distDir, 'f.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 1);

    // b.html hitting the parallel request limit should not prevent g.html from being optimized
    html = await outputFS.readFile(path.join(distDir, 'g.html'), 'utf8');
    assert.equal(html.match(/<script/g).length, 2);
  });

  it('should not add CSS to a worker bundle group', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-sibling-worker-css/index.html'),
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['style.css'],
      },
      {
        type: 'html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['a.js', 'worker.js', 'esmodule-helpers.js'],
      },
      {
        type: 'js',
        assets: [
          'a.js',
          'bundle-url.js',
          'esmodule-helpers.js',
          'get-worker-url.js',
          'index.js',
          'JSRuntime.js',
        ],
      },
    ]);

    let htmlBundle = b.getBundles().find(b => b.type === 'html');
    let htmlSiblings = b.getReferencedBundles(htmlBundle);
    assert.equal(htmlSiblings.length, 2);
    assert(htmlSiblings.some(b => b.type === 'js'));
    assert(htmlSiblings.some(b => b.type === 'css'));

    let worker = b.getChildBundles(htmlSiblings.find(b => b.type === 'js'));
    assert.equal(worker.length, 1);
    let workerSiblings = b.getReferencedBundles(worker[0]);
    assert.equal(workerSiblings.length, 0);
  });

  it('should correctly add sibling bundles to all using bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-sibling/*.html'),
    );

    assertBundles(b, [
      {
        type: 'html',
        assets: ['form.html'],
      },
      {
        type: 'js',
        assets: ['form.js', 'a.js', 'a.module.css', 'esmodule-helpers.js'],
      },
      {
        type: 'css',
        assets: ['a.module.css'],
      },
      {
        type: 'html',
        assets: ['searchfield.html'],
      },
      {
        type: 'js',
        assets: [
          'searchfield.js',
          'a.js',
          'a.module.css',
          'b.js',
          'esmodule-helpers.js',
        ],
      },
      {
        type: 'html',
        assets: ['searchfield2.html'],
      },
      {
        type: 'js',
        assets: [
          'searchfield2.js',
          'a.js',
          'a.module.css',
          'b.js',
          'esmodule-helpers.js',
        ],
      },
    ]);

    for (let htmlBundle of b.getBundles().filter(b => b.type === 'html')) {
      let htmlSiblings = b
        .getReferencedBundles(htmlBundle, true)
        .map(b => b.type)
        .sort();
      assert.deepEqual(htmlSiblings, ['css', 'js']);
    }
  });

  it('should remove duplicate assets from sibling bundles', async function() {
    let bundleGraph = await bundle(
      path.join(__dirname, '/integration/shared-sibling-duplicate/*.html'),
      {mode: 'production'},
    );

    bundleGraph.traverseBundles(bundle => {
      bundle.traverseAssets(asset => {
        let bundles = bundleGraph.findBundlesWithAsset(asset);
        assert.equal(
          bundles.length,
          1,
          `asset ${asset.filePath} is duplicated`,
        );
      });
    });
  });

  it('should support split bundles with many pages with esmodule output', async function() {
    await bundle(path.join(__dirname, '/integration/shared-many-esm/*.html'), {
      defaultTargetOptions: {
        shouldScopeHoist: true,
      },
    });

    let checkHtml = async filename => {
      // Find all scripts referenced in the HTML file
      let html = await outputFS.readFile(path.join(distDir, filename), 'utf8');
      let re = /<script.*?src="(.*?)"/g;
      let match;
      let scripts = new Set();
      while ((match = re.exec(html))) {
        scripts.add(path.join(distDir, match[1]));
      }

      assert(scripts.size > 0, 'no scripts found');

      // Ensure that those scripts don't import anything other than what's in the HTML.
      for (let script of scripts) {
        let js = await outputFS.readFile(script, 'utf8');
        let re = /import .*? from "(.*?)"/g;
        let match;
        while ((match = re.exec(js))) {
          let imported = path.join(distDir, match[1]);
          assert(
            scripts.has(imported),
            `unknown script ${match[1]} imported in ${path.basename(script)}`,
          );
        }
      }
    };

    for (let letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      await checkHtml(letter + '.html');
    }
  });

  it('should include the correct paths when using multiple entries and referencing style from html and js', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-multi-entry/*.html'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'a.html',
        type: 'html',
        assets: ['a.html'],
      },
      {
        name: 'b.html',
        type: 'html',
        assets: ['b.html'],
      },
      {
        type: 'css',
        assets: ['style.css'],
      },
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    let firstHtmlFile = await outputFS.readFile(
      path.join(distDir, 'a.html'),
      'utf8',
    );

    let secondHtmlFile = await outputFS.readFile(
      path.join(distDir, 'b.html'),
      'utf8',
    );

    let bundles = b.getBundles();
    let cssBundle = path.basename(
      bundles.find(bundle => bundle.filePath.endsWith('.css')).filePath,
    );
    let jsBundle = path.basename(
      bundles.find(bundle => bundle.filePath.endsWith('.js')).filePath,
    );

    assert(
      firstHtmlFile.includes(cssBundle),
      `a.html should include a reference to ${cssBundle}`,
    );
    assert(
      secondHtmlFile.includes(cssBundle),
      `b.html should include a reference to ${cssBundle}`,
    );

    assert(
      firstHtmlFile.includes(jsBundle),
      `a.html should include a reference to ${jsBundle}`,
    );
    assert(
      secondHtmlFile.includes(jsBundle),
      `b.html should include a reference to ${jsBundle}`,
    );
  });

  it('should invalidate parent bundle when inline bundles change', async function() {
    // copy into memory fs
    await ncp(
      path.join(__dirname, '/integration/html-inline-js-require'),
      path.join(__dirname, '/html-inline-js-require'),
    );

    let distDir = path.join(outputFS.cwd(), 'dist');

    let b = await bundler(
      path.join(__dirname, '/html-inline-js-require/index.html'),
      {
        inputFS: overlayFS,
        shouldDisableCache: false,
        defaultTargetOptions: {
          distDir,
        },
      },
    );

    subscription = await b.watch();
    await getNextBuild(b);

    let html = await outputFS.readFile('/dist/index.html', 'utf8');
    assert(html.includes("console.log('test')"));

    await overlayFS.writeFile(
      path.join(__dirname, '/html-inline-js-require/test.js'),
      "console.log('foo')",
    );
    await getNextBuild(b);

    html = await outputFS.readFile(path.join(distDir, '/index.html'), 'utf8');
    assert(html.includes("console.log('foo')"));
  });

  it('should invalidate parent bundle when nested inline bundles change', async function() {
    // copy into memory fs
    await ncp(
      path.join(__dirname, '/integration/html-inline-js-nested'),
      path.join(__dirname, '/html-inline-js-nested'),
    );

    let distDir = path.join(outputFS.cwd(), 'dist');

    let b = await bundler(
      path.join(__dirname, '/html-inline-js-nested/index.html'),
      {
        inputFS: overlayFS,
        shouldDisableCache: false,
        defaultTargetOptions: {
          distDir,
        },
      },
    );

    subscription = await b.watch();
    await getNextBuild(b);

    let html = await outputFS.readFile('/dist/index.html', 'utf8');
    assert(html.includes('module.exports = "hello world"'));
    assert(html.includes('console.log'));

    await overlayFS.writeFile(
      path.join(__dirname, '/html-inline-js-nested/test.txt'),
      'foo bar',
    );
    await getNextBuild(b);

    html = await outputFS.readFile(path.join(distDir, 'index.html'), 'utf8');
    assert(!html.includes('module.exports = "hello world"'));
    assert(html.includes('module.exports = "foo bar"'));
    assert(html.includes('console.log'));
  });

  it('should inline data-urls', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/data-url/index.html'),
      {
        defaultTargetOptions: {
          sourceMaps: false,
        },
      },
    );

    let contents = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'html').filePath,
      'utf8',
    );
    assert.equal(
      contents.trim(),
      `<img src="data:image/svg+xml,%3Csvg%20width%3D%22120%22%20height%3D%27120%27%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%20%20%3Cfilter%20id%3D%22blur-_.%21~%2a%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%225%22%2F%3E%0A%20%20%3C%2Ffilter%3E%0A%20%20%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2250%22%20fill%3D%22green%22%20filter%3D%22url%28%23blur-_.%21~%2a%29%22%20%2F%3E%0A%3C%2Fsvg%3E%0A">`,
    );
  });

  it('should print a diagnostic for invalid bundler options', async () => {
    let dir = path.join(__dirname, 'integration/invalid-bundler-config');
    let pkg = path.join(dir, 'package.json');
    let code = await inputFS.readFileSync(pkg, 'utf8');
    await assert.rejects(() => bundle(path.join(dir, 'index.html')), {
      name: 'BuildError',
      diagnostics: [
        {
          message: 'Invalid config for @parcel/bundler-default',
          origin: '@parcel/bundler-default',
          filePath: pkg,
          language: 'json',
          codeFrame: {
            code,
            codeHighlights: [
              {
                message: 'Did you mean "minBundleSize", "minBundles"?',
                start: {
                  column: 30,
                  line: 3,
                },
                end: {
                  column: 45,
                  line: 3,
                },
              },
            ],
          },
        },
      ],
    });
  });
});
