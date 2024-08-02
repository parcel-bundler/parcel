import assert from 'assert';
import path from 'path';
import {
  bundle as _bundle,
  describe,
  it,
  overlayFS,
  outputFS,
  ncp,
} from '@parcel/test-utils';

const distDir = path.join(__dirname, './dist');

function bundle(path) {
  return _bundle(path, {
    inputFS: overlayFS,
    shouldDisableCache: false,
    defaultTargetOptions: {
      distDir,
    },
  });
}

describe.v2('content hashing', function () {
  beforeEach(async () => {
    await outputFS.rimraf(path.join(__dirname, '/input'));
  });

  it('should update content hash when content changes', async function () {
    await ncp(
      path.join(__dirname, '/integration/html-css'),
      path.join(__dirname, '/input'),
    );

    let bundleHtml = () => bundle(path.join(__dirname, '/input/index.html'));
    await bundleHtml();

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    let filename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(index\.[a-f0-9]+\.css)">/,
    )[1];
    assert(await outputFS.exists(path.join(distDir, filename)));

    await outputFS.writeFile(
      path.join(__dirname, '/input/index.css'),
      'body { background: green }',
    );
    await bundleHtml();

    html = await outputFS.readFile(path.join(distDir, 'index.html'), 'utf8');
    let newFilename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(index\.[a-f0-9]+\.css)">/,
    )[1];
    assert(await outputFS.exists(path.join(distDir, newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function () {
    await ncp(
      path.join(__dirname, '/integration/import-raw'),
      path.join(__dirname, '/input'),
    );

    let bundleJs = () => bundle(path.join(__dirname, '/input/index.js'));
    await bundleJs();

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    let filename = js.match(/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await outputFS.exists(path.join(distDir, filename)));

    await outputFS.writeFile(
      path.join(__dirname, '/input/test.txt'),
      'hello world',
    );
    await bundleJs();

    js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    let newFilename = js.match(/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await outputFS.exists(path.join(distDir, newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should consider bundles with identical contents coming from different filepaths unique', async () => {
    await _bundle(
      path.join(
        __dirname,
        'integration/same-contents-different-filepaths/index.js',
      ),
    );
  });

  it('should generate the same hash for the same distDir inside separate projects', async () => {
    let a = await _bundle(
      path.join(__dirname, 'integration/hash-distDir/a/index.html'),
      {sourceMaps: true},
    );
    let b = await _bundle(
      path.join(__dirname, 'integration/hash-distDir/b/index.html'),
      {sourceMaps: true},
    );

    let aBundles = a.getBundles();
    let bBundles = b.getBundles();

    assert.equal(aBundles.length, 2);
    assert.equal(bBundles.length, 2);

    let aJS = aBundles.find(bundle => bundle.type === 'js');
    let bJS = bBundles.find(bundle => bundle.type === 'js');
    assert(/index\.[a-f0-9]*\.js/.test(path.basename(aJS.filePath)));
    assert.equal(aJS.name, bJS.name);
  });
});
