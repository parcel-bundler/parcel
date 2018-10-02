const assert = require('assert');
const fs = require('../src/utils/fs');
const {bundle, assertBundleTree} = require('./utils');
const path = require('path');

describe('html', function() {
  it('should support bundling HTML', async function() {
    let b = await bundle(path.join(__dirname, '/integration/html/index.html'));

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'png',
          assets: ['100x100.png'],
          childBundles: []
        },
        {
          type: 'svg',
          assets: ['icons.svg'],
          childBundles: []
        },
        {
          type: 'css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'js',
              assets: ['index.js'],
              childBundles: [
                {
                  type: 'map'
                }
              ]
            }
          ]
        }
      ]
    });

    let files = await fs.readdir(path.join(__dirname, '/dist'));
    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    for (let file of files) {
      let ext = file.match(/\.([0-9a-z]+)(?:[?#]|$)/i)[0];
      if (file !== 'index.html' && ext !== '.map') {
        assert(html.includes(file));
      }
    }
  });

  it('should find href attr when not first', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-attr-order/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: []
        }
      ]
    });
  });

  it('should support transforming HTML with posthtml', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: []
    });

    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    assert(html.includes('<h1>Other page</h1>'));
  });

  it('should find assets inside posthtml', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml-assets/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should add dependencies referenced by posthtml-include', async () => {
    const b = await bundle(
      path.join(__dirname, '/integration/posthtml-assets/index.html')
    );
    const asset = b.assets.values().next().value;
    const other = path.join(
      __dirname,
      '/integration/posthtml-assets/other.html'
    );
    assert(asset.dependencies.has(other));
    assert(asset.dependencies.get(other).includedInParent);
  });

  it('should add dependencies referenced by plugins', async () => {
    const b = await bundle(
      path.join(__dirname, '/integration/posthtml-plugin-deps/index.html')
    );
    const asset = b.assets.values().next().value;
    const other = path.join(
      __dirname,
      '/integration/posthtml-plugin-deps/base.html'
    );
    assert(asset.dependencies.has(other));
    assert(asset.dependencies.get(other).includedInParent);
  });

  it('should insert sibling CSS bundles for JS files in the HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js', 'index.css'],
          childBundles: [
            {
              type: 'css',
              assets: ['index.css'],
              childBundles: []
            },
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    assert(
      /<link rel="stylesheet" href="[/\\]{1}html-css\.[a-f0-9]+\.css">/.test(
        html
      )
    );
  });

  it('should insert sibling bundles before body element if no HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-head/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js', 'index.css'],
          childBundles: [
            {
              type: 'css',
              assets: ['index.css'],
              childBundles: []
            },
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    assert(
      /<html>\s*<link rel="stylesheet" href="[/\\]{1}html-css-head\.[a-f0-9]+\.css">\s*<body>/.test(
        html
      )
    );
  });

  it('should insert sibling JS bundles for CSS files in the HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-js/index.html'),
      {
        hmr: true
      }
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'css',
          assets: ['index.css'],
          childBundles: [
            {
              type: 'map'
            },
            {
              type: 'js',
              assets: [
                'index.css',
                'bundle-url.js',
                'css-loader.js',
                'hmr-runtime.js'
              ],
              childBundles: []
            }
          ]
        }
      ]
    });

    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    assert(/<script src="[/\\]{1}html-css-js\.[a-f0-9]+\.js">/.test(html));
  });

  it('should insert sibling bundles at correct location in tree when optional elements are absent', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-optional-elements/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js', 'index.css'],
          childBundles: [
            {
              type: 'css',
              assets: ['index.css'],
              childBundles: []
            },
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'js',
          assets: ['other.js']
        }
      ]
    });

    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    assert(
      /<\/script>\s*<link rel="stylesheet" href="[/\\]{1}html-css-optional-elements\.[a-f0-9]+\.css"><h1>Hello/.test(
        html
      )
    );
  });

  it('should minify HTML in production mode', async function() {
    await bundle(path.join(__dirname, '/integration/htmlnano/index.html'), {
      production: true
    });

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    assert(html.includes('Other page'));
    assert(!html.includes('\n'));
  });

  it('should read .htmlnanorc and minify HTML in production mode', async function() {
    await bundle(
      path.join(__dirname, '/integration/htmlnano-config/index.html'),
      {
        production: true
      }
    );

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );

    // minifyJson
    assert(
      html.includes('<script type="application/json">{"user":"me"}</script>')
    );

    // mergeStyles
    assert(
      html.includes(
        '<style>h1{color:red}div{font-size:20px}</style><style media="print">div{color:#00f}</style>'
      )
    );

    // minifySvg is false
    assert(
      html.includes(
        '<svg version="1.1" baseprofile="full" width="300" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="red"></rect><circle cx="150" cy="100" r="80" fill="green"></circle><text x="150" y="125" font-size="60" text-anchor="middle" fill="white">SVG</text></svg>'
      )
    );
  });

  it('should not minify default values inside HTML in production mode', async function() {
    await bundle(
      path.join(__dirname, '/integration/htmlnano-defaults-form/index.html'),
      {
        production: true
      }
    );

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    assert(html.includes('<input type="text">'));
    assert(!html.includes('\n'));
  });

  it('should not prepend the public path to assets with remote URLs', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    assert(
      html.includes('<script src="https://unpkg.com/parcel-bundler"></script>')
    );
  });

  it('should not prepend the public path to hash links', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    assert(html.includes('<a href="#hash_link">'));
  });

  it('should detect virtual paths', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-virtualpath/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: []
        }
      ]
    });
  });

  it('should not update root/main file in the bundles', async function() {
    await bundle(path.join(__dirname, '/integration/html-root/index.html'));

    let files = await fs.readdir(path.join(__dirname, '/dist'));

    for (let file of files) {
      if (file !== 'index.html' && file.endsWith('.html')) {
        let html = await fs.readFile(path.join(__dirname, '/dist/', file));
        assert(html.includes('index.html'));
      }
    }
  });

  it('should conserve the spacing in the HTML tags', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'), {
      production: true
    });

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    assert(/<i>hello<\/i> <i>world<\/i>/.test(html));
  });

  it('should support child bundles of different types', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/child-bundle-different-types/index.html'
      )
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['main.js', 'util.js', 'other.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'js',
              assets: ['index.js', 'util.js', 'other.js'],
              childBundles: [
                {
                  type: 'map'
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it('should support circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/circular/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'html',
          assets: ['about.html'],
          childBundles: [
            {
              type: 'js',
              assets: ['about.js', 'index.js'],
              childBundles: [
                {
                  type: 'map'
                }
              ]
            },
            {
              type: 'html',
              assets: ['test.html'],
              childBundles: []
            }
          ]
        },
        {
          type: 'js',
          assets: ['about.js', 'index.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should support bundling HTM', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/htm-extension/index.htm')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.htm'],
      type: 'html',
      childBundles: [
        {
          type: 'js',
          assets: ['index.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should detect srcset attribute', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-srcset/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'png',
          assets: ['100x100.png'],
          childBundles: []
        },
        {
          type: 'png',
          assets: ['200x200.png'],
          childBundles: []
        },
        {
          type: 'png',
          assets: ['300x300.png'],
          childBundles: []
        }
      ]
    });
  });

  it('should detect srcset attribute of source element', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-source-srcset/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'png',
          assets: ['100x100.png'],
          childBundles: []
        },
        {
          type: 'png',
          assets: ['200x200.png'],
          childBundles: []
        },
        {
          type: 'png',
          assets: ['300x300.png'],
          childBundles: []
        }
      ]
    });
  });

  it('should support webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webmanifest/index.html')
    );

    await assertBundleTree(b, {
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
              childBundles: []
            }
          ]
        }
      ]
    });
  });

  it('should bundle svg files correctly', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'svg',
          assets: ['file.svg']
        }
      ]
    });
  });

  it('should support data attribute of object element', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-object/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'svg',
          assets: ['file.svg'],
          childBundles: []
        }
      ]
    });
  });

  it('should resolve assets containing spaces', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-spaces/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'html',
          assets: ['other page.html'],
          childBundles: []
        }
      ]
    });
  });

  it('should process inline JS', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js/index.html'),
      {
        production: true
      }
    );

    const bundleContent = (await fs.readFile(b.name)).toString();
    assert(!bundleContent.includes('someArgument'));
  });

  it('should process inline styles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-styles/index.html'),
      {production: true}
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'jpg',
          assets: ['bg.jpg'],
          childBundles: []
        },
        {
          type: 'jpg',
          assets: ['img.jpg'],
          childBundles: []
        }
      ]
    });
  });

  it('should process inline styles using lang', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-sass/index.html'),
      {production: true}
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html']
    });

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );

    assert(html.includes('<style>.index{color:#00f}</style>'));
  });

  it('should process inline non-js scripts', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-coffeescript/index.html'),
      {production: true}
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html']
    });

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );

    assert(html.includes('alert("Hello, World!")'));
  });

  it('should handle inline css with @imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-css-import/index.html'),
      {production: true}
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'css',
          assets: ['test.css']
        }
      ]
    });

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    assert(html.includes('@import'));
  });

  it('should error on imports and requires in inline <script> tags', async function() {
    let err;
    try {
      await bundle(
        path.join(__dirname, '/integration/html-inline-js-require/index.html'),
        {production: true}
      );
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.equal(
      err.message,
      'Imports and requires are not supported inside inline <script> tags yet.'
    );
  });
});
