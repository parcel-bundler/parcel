import assert from 'assert';
import {
  bundle,
  assertBundles,
  assertBundleTree,
  removeDistDirectory,
  distDir,
  run,
  inputFS,
  outputFS
} from '@parcel/test-utils';
import path from 'path';

describe('html', function() {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should support bundling HTML', async () => {
    let b = await bundle(path.join(__dirname, '/integration/html/index.html'));

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'png',
        assets: ['100x100.png']
      },
      {
        type: 'svg',
        assets: ['icons.svg']
      },
      {
        type: 'css',
        assets: ['index.css']
      },
      {
        type: 'html',
        assets: ['other.html']
      },
      {
        type: 'js',
        assets: ['index.js']
      }
    ]);

    let files = await outputFS.readdir(distDir);
    let html = await outputFS.readFile(path.join(distDir, 'index.html'));
    for (let file of files) {
      let ext = file.match(/\.([0-9a-z]+)(?:[?#]|$)/i)[0];
      if (file !== 'index.html' && ext !== '.map') {
        assert(html.includes(file));
      }
    }

    let value = null;
    await run(b, {
      alert: v => (value = v)
    });
    assert.equal(value, 'Hi');
  });

  it('should find href attr when not first', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-attr-order/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'html',
        assets: ['other.html']
      }
    ]);
  });

  it('should insert sibling CSS bundles for JS files in the HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'js',
        assets: ['index.js']
      },
      {
        type: 'css',
        assets: ['index.css']
      }
    ]);

    let html = await outputFS.readFile(path.join(distDir, 'index.html'));
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

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'js',
        assets: ['index.js']
      },
      {
        type: 'css',
        assets: ['index.css']
      }
    ]);

    let html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(
      /<html>\s*<link rel="stylesheet" href="[/\\]{1}html-css-head\.[a-f0-9]+\.css">\s*<body>/.test(
        html
      )
    );
  });

  it.skip('should insert sibling JS bundles for CSS files in the HEAD', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-js/index.html'),
      {
        hmr: true
      }
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'css',
        assets: ['index.css']
      },
      {
        type: 'js',
        assets: [
          'index.css',
          'bundle-url.js',
          'css-loader.js',
          'hmr-runtime.js'
        ]
      }
    ]);

    let html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(/<script src="[/\\]{1}html-css-js\.[a-f0-9]+\.js">/.test(html));
  });

  it('should insert sibling bundles at correct location in tree when optional elements are absent', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-css-optional-elements/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'js',
        assets: ['index.js']
      },
      {
        type: 'css',
        assets: ['index.css']
      },
      {
        type: 'js',
        assets: ['other.js']
      }
    ]);

    let html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(
      /<\/script>\s*<link rel="stylesheet" href="[/\\]{1}html-css-optional-elements\.[a-f0-9]+\.css"><h1>Hello/.test(
        html
      )
    );
  });

  it.skip('should minify HTML in production mode', async function() {
    let inputFile = path.join(__dirname, '/integration/htmlnano/index.html');
    await bundle(inputFile, {
      production: true
    });

    let inputSize = (await inputFS.stat(inputFile)).size;

    let outputFile = path.join(__dirname, '/dist/index.html');
    let outputSize = (await outputFS.stat(outputFile)).size;

    assert(inputSize > outputSize);

    let html = await outputFS.readFile(outputFile, 'utf8');
    assert(html.includes('Other page'));
  });

  it('should work with an empty html file', async function() {
    let inputFile = path.join(__dirname, '/integration/html-empty/index.html');
    await bundle(inputFile, {
      minify: false
    });

    let outputFile = path.join(distDir, 'index.html');
    let html = await outputFS.readFile(outputFile, 'utf8');
    assert.equal(html.length, 0);
  });

  it.skip('should read .htmlnanorc and minify HTML in production mode', async function() {
    await bundle(
      path.join(__dirname, '/integration/htmlnano-config/index.html'),
      {
        production: true
      }
    );

    let html = await outputFS.readFile(
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
        '<svg version="1.1" baseProfile="full" width="300" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="red"></rect><circle cx="150" cy="100" r="80" fill="green"></circle><text x="150" y="125" font-size="60" text-anchor="middle" fill="white">SVG</text></svg>'
      )
    );
  });

  it.skip('should not minify default values inside HTML in production mode', async function() {
    let inputFile = path.join(
      __dirname,
      '/integration/htmlnano-defaults-form/index.html'
    );
    await bundle(inputFile, {
      production: true
    });

    let inputSize = (await inputFS.stat(inputFile)).size;

    let outputFile = path.join(__dirname, '/dist/index.html');
    let outputSize = (await outputFS.stat(outputFile)).size;

    assert(inputSize > outputSize);

    let html = await outputFS.readFile(outputFile, 'utf8');
    assert(html.includes('<input type="text">'));
  });

  it('should not prepend the public path to assets with remote URLs', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8'
    );
    assert(
      html.includes('<script src="https://unpkg.com/parcel-bundler"></script>')
    );
  });

  it('should not prepend the public path to hash links', async function() {
    await bundle(path.join(__dirname, '/integration/html/index.html'));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8'
    );
    assert(html.includes('<a href="#hash_link">'));
  });

  it('should detect virtual paths', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-virtualpath/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'html',
        assets: ['other.html']
      }
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
    await bundle(path.join(__dirname, '/integration/html/index.html'), {
      production: true
    });

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
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

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'js',
        assets: ['main.js', 'util.js', 'other.js']
      },
      {
        type: 'html',
        assets: ['other.html']
      },
      {
        type: 'js',
        assets: ['index.js', 'util.js', 'other.js']
      }
    ]);
  });

  it.skip('should support circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/circular/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'html',
        assets: ['about.html']
      },
      {
        type: 'js',
        assets: ['about.js', 'index.js']
      },
      {
        type: 'html',
        assets: ['test.html']
      },
      {
        type: 'js',
        assets: ['about.js', 'index.js']
      }
    ]);
  });

  it('should support bundling HTM', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/htm-extension/index.htm')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.htm'],
        type: 'html'
      },
      {
        type: 'js',
        assets: ['index.js']
      }
    ]);
  });

  it('should detect srcset attribute', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-srcset/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'png',
        assets: ['100x100.png']
      },
      {
        type: 'png',
        assets: ['200x200.png']
      },
      {
        type: 'png',
        assets: ['300x300.png']
      }
    ]);
  });

  it('should detect srcset attribute of source element', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-source-srcset/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'png',
        assets: ['100x100.png']
      },
      {
        type: 'png',
        assets: ['200x200.png']
      },
      {
        type: 'png',
        assets: ['300x300.png']
      }
    ]);
  });

  it.skip('should support webmanifest', async function() {
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

  it.skip("should treat webmanifest as an entry module so it doesn't get content hashed", async function() {
    const b = await bundle(
      path.join(__dirname, '/integration/html-manifest/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'webmanifest',
          assets: ['manifest.webmanifest']
        }
      ]
    });

    const html = await outputFS.readFile(
      path.join(__dirname, '/dist/index.html')
    );
    assert(html.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  });

  it('should bundle svg files correctly', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'svg',
        assets: ['file.svg']
      }
    ]);
  });

  it('should bundle svg files using <image xlink:href=""> correctly', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg-image/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'svg',
        assets: ['file.svg']
      }
    ]);
  });

  // Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Element/script
  it('should bundle scripts inside svg', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-svg-script/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'js',
        assets: ['script-a.js']
      },
      {
        type: 'js',
        assets: ['script-b.js']
      }
    ]);
  });

  it('should support data attribute of object element', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-object/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'svg',
        assets: ['file.svg']
      }
    ]);
  });

  it('should resolve assets containing spaces', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-spaces/index.html')
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'html',
        assets: ['other page.html']
      }
    ]);
  });

  it('should process inline JS', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js/index.html'),
      {minify: true}
    );

    // inline bundles are not output, but are apart of the bundleGraph
    assertBundles(b, [
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {name: 'index.html', assets: ['index.html']}
    ]);

    let files = await outputFS.readdir(distDir);
    // assert that the inline js files are not output
    assert(!files.some(filename => filename.includes('js')));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf-8'
    );

    assert(!html.includes('someArgument'));
  });

  it('should add an inline sourcemap to inline JS', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js/index.html'),
      {minify: false}
    );

    // inline bundles are not output, but are apart of the bundleGraph
    assertBundles(b, [
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {type: 'js', assets: ['index.html']},
      {name: 'index.html', assets: ['index.html']}
    ]);

    let files = await outputFS.readdir(distDir);
    // assert that the inline js files are not output
    assert(!files.some(filename => filename.includes('js')));

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf-8'
    );

    assert(
      html.includes(
        '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,ey'
      )
    );
  });

  it('should process inline styles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-styles/index.html'),
      {minify: true}
    );

    await assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html']
      },
      {
        type: 'css',
        assets: ['index.html']
      },
      {
        type: 'css',
        assets: ['index.html']
      },
      {
        type: 'css',
        assets: ['index.html']
      },
      {
        type: 'jpg',
        assets: ['bg.jpg']
      },
      {
        type: 'jpg',
        assets: ['img.jpg']
      },
      {
        name: 'index.html',
        assets: ['index.html']
      }
    ]);
  });

  it('should process inline styles using lang', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-sass/index.html'),
      {minify: true}
    );

    await assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html']
      },
      {
        name: 'index.html',
        assets: ['index.html']
      }
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8'
    );
    assert(html.includes('<style>.index{color:#00f}</style>'));
  });

  it('should process inline non-js scripts', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-coffeescript/index.html'),
      {minify: true}
    );

    await assertBundles(b, [
      {
        type: 'js',
        assets: ['index.html']
      },
      {
        name: 'index.html',
        assets: ['index.html']
      }
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8'
    );
    assert(html.includes('alert("Hello, World!")'));
  });

  it('should handle inline css with @imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-css-import/index.html'),
      {production: true}
    );

    await assertBundles(b, [
      {
        type: 'css',
        assets: ['index.html', 'test.css']
      },
      {
        name: 'index.html',
        assets: ['index.html']
      }
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8'
    );
    assert(!html.includes('@import'));
  });

  it('should allow imports and requires in inline <script> tags', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/html-inline-js-require/index.html'),
      {minify: true}
    );

    await assertBundles(b, [
      {
        type: 'js',
        assets: ['index.html', 'test.js']
      },
      {
        name: 'index.html',
        assets: ['index.html']
      }
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8'
    );
    assert(html.includes('console.log("test")'));
  });
});
