import assert from 'assert';
import path from 'path';
import {
  bundle,
  bundler,
  assertBundles,
  outputFS,
  ncp,
  overlayFS,
  getNextBuild
} from '@parcel/test-utils';

describe('monorepos', function() {
  beforeEach(async () => {
    await outputFS.rimraf(path.join(__dirname, '/monorepo'));
  });

  let subscription;
  afterEach(async () => {
    if (subscription) {
      await subscription.unsubscribe();
      subscription = null;
    }
  });

  it('should build multiple packages in a monorepo at once, pointing at index files', async function() {
    let b = await bundle(
      [
        path.join(__dirname, '/integration/monorepo/pkg-a/src/index.js'),
        path.join(__dirname, '/integration/monorepo/pkg-b/src/index.js')
      ],
      {scopeHoist: true}
    );

    assertBundles(b, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-b.cjs.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.module.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.cjs.css',
        assets: ['index.module.css']
      },
      {
        name: 'pkg-b.module.css',
        assets: ['index.module.css']
      }
    ]);

    let contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.cjs.js'),
      'utf8'
    );
    assert(contents.includes('exports.default ='));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.module.js'),
      'utf8'
    );
    assert(contents.includes('export default function'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.js'),
      'utf8'
    );
    assert(contents.includes('require("./pkg-b.cjs.css")'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.js'),
      'utf8'
    );
    assert(contents.includes('import "./pkg-b.module.css"'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));
  });

  it('should build multiple packages in a monorepo at once, pointing at directories with "source" field in package.json', async function() {
    let b = await bundle(
      [
        path.join(__dirname, '/integration/monorepo/pkg-a'),
        path.join(__dirname, '/integration/monorepo/pkg-b')
      ],
      {scopeHoist: true}
    );

    assertBundles(b, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-b.cjs.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.module.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.cjs.css',
        assets: ['index.module.css']
      },
      {
        name: 'pkg-b.module.css',
        assets: ['index.module.css']
      }
    ]);

    let contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.cjs.js'),
      'utf8'
    );
    assert(contents.includes('exports.default ='));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.module.js'),
      'utf8'
    );
    assert(contents.includes('export default function'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.js'),
      'utf8'
    );
    assert(contents.includes('require("./pkg-b.cjs.css")'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.js'),
      'utf8'
    );
    assert(contents.includes('import "./pkg-b.module.css"'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));
  });

  it('should build multiple packages in a monorepo at once, pointing at a glob of files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/monorepo/*/src/index.js'),
      {scopeHoist: true}
    );

    assertBundles(b, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-b.cjs.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.module.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.cjs.css',
        assets: ['index.module.css']
      },
      {
        name: 'pkg-b.module.css',
        assets: ['index.module.css']
      }
    ]);

    let contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.cjs.js'),
      'utf8'
    );
    assert(contents.includes('exports.default ='));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.module.js'),
      'utf8'
    );
    assert(contents.includes('export default function'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.js'),
      'utf8'
    );
    assert(contents.includes('require("./pkg-b.cjs.css")'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.js'),
      'utf8'
    );
    assert(contents.includes('import "./pkg-b.module.css"'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));
  });

  it('should build multiple packages in a monorepo at once, pointing at a glob of directories', async function() {
    let b = await bundle(path.join(__dirname, '/integration/monorepo/*'), {
      scopeHoist: true
    });

    assertBundles(b, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-b.cjs.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.module.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.cjs.css',
        assets: ['index.module.css']
      },
      {
        name: 'pkg-b.module.css',
        assets: ['index.module.css']
      }
    ]);

    let contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.cjs.js'),
      'utf8'
    );
    assert(contents.includes('exports.default ='));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-a/dist/pkg-a.module.js'),
      'utf8'
    );
    assert(contents.includes('export default function'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.js'),
      'utf8'
    );
    assert(contents.includes('require("./pkg-b.cjs.css")'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.cjs.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.js'),
      'utf8'
    );
    assert(contents.includes('import "./pkg-b.module.css"'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/integration/monorepo/pkg-b/dist/pkg-b.module.css'),
      'utf8'
    );
    assert(contents.includes('._foo'));
  });

  it('should watch glob entries and build new packages that are added', async function() {
    // copy into memory fs
    await ncp(
      path.join(__dirname, '/integration/monorepo/pkg-a'),
      path.join(__dirname, '/monorepo/pkg-a')
    );

    let b = await bundler(path.join(__dirname, '/monorepo/*'), {
      scopeHoist: true,
      inputFS: overlayFS
    });

    subscription = await b.watch();
    let evt = await getNextBuild(b);

    assertBundles(evt.bundleGraph, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      }
    ]);

    await ncp(
      path.join(__dirname, '/integration/monorepo/pkg-b'),
      path.join(__dirname, '/monorepo/pkg-b')
    );

    evt = await getNextBuild(b);
    assertBundles(evt.bundleGraph, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-b.cjs.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.module.js',
        assets: ['index.js', 'index.module.css']
      },
      {
        name: 'pkg-b.cjs.css',
        assets: ['index.module.css']
      },
      {
        name: 'pkg-b.module.css',
        assets: ['index.module.css']
      }
    ]);
  });

  it('should watch package.json containing "source" field for changes', async function() {
    // copy into memory fs
    await ncp(
      path.join(__dirname, '/integration/monorepo/pkg-a'),
      path.join(__dirname, '/monorepo/pkg-a')
    );

    let b = await bundler(path.join(__dirname, '/monorepo/*'), {
      scopeHoist: true,
      inputFS: overlayFS
    });

    subscription = await b.watch();
    let evt = await getNextBuild(b);

    assertBundles(evt.bundleGraph, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      }
    ]);

    let pkgFile = path.join(__dirname, '/monorepo/pkg-a/package.json');
    let pkg = JSON.parse(await outputFS.readFile(pkgFile, 'utf8'));
    await outputFS.writeFile(
      pkgFile,
      JSON.stringify({...pkg, source: 'src/alt.js'})
    );

    evt = await getNextBuild(b);
    assert(evt.type === 'buildSuccess');
    assertBundles(evt.bundleGraph, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['alt.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['alt.js']
      }
    ]);

    let contents = await outputFS.readFile(
      path.join(__dirname, '/monorepo/pkg-a/dist/pkg-a.cjs.js'),
      'utf8'
    );
    assert(contents.includes('return 3'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/monorepo/pkg-a/dist/pkg-a.module.js'),
      'utf8'
    );
    assert(contents.includes('return 3'));
  });

  it('should watch package.json containing targets for changes', async function() {
    // copy into memory fs
    await ncp(
      path.join(__dirname, '/integration/monorepo/pkg-a'),
      path.join(__dirname, '/monorepo/pkg-a')
    );

    let b = await bundler(path.join(__dirname, '/monorepo/*'), {
      scopeHoist: true,
      inputFS: overlayFS
    });

    subscription = await b.watch();
    let evt = await getNextBuild(b);

    assertBundles(evt.bundleGraph, [
      {
        name: 'pkg-a.cjs.js',
        assets: ['index.js']
      },
      {
        name: 'pkg-a.module.js',
        assets: ['index.js']
      }
    ]);

    let pkgFile = path.join(__dirname, '/monorepo/pkg-a/package.json');
    let pkg = JSON.parse(await outputFS.readFile(pkgFile, 'utf8'));
    await outputFS.writeFile(
      pkgFile,
      JSON.stringify({
        ...pkg,
        main: 'dist/alt.js',
        module: 'dist/alt.module.js'
      })
    );

    evt = await getNextBuild(b);
    assertBundles(evt.bundleGraph, [
      {
        name: 'alt.js',
        assets: ['index.js']
      },
      {
        name: 'alt.module.js',
        assets: ['index.js']
      }
    ]);

    let contents = await outputFS.readFile(
      path.join(__dirname, '/monorepo/pkg-a/dist/alt.js'),
      'utf8'
    );
    assert(contents.includes('return 2'));

    contents = await outputFS.readFile(
      path.join(__dirname, '/monorepo/pkg-a/dist/alt.module.js'),
      'utf8'
    );
    assert(contents.includes('return 2'));
  });
});
