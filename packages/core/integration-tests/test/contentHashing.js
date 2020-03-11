import assert from 'assert';
import path from 'path';
import {
  bundle as _bundle,
  distDir,
  overlayFS,
  outputFS,
  ncp,
} from '@parcel/test-utils';

function bundle(path) {
  return _bundle(path, {
    inputFS: overlayFS,
    disableCache: false,
  });
}

describe('content hashing', function() {
  beforeEach(async () => {
    await outputFS.rimraf(path.join(__dirname, '/input'));
  });

  it('should update content hash when content changes', async function() {
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
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/,
    )[1];
    assert(await outputFS.exists(path.join(distDir, filename)));

    await outputFS.writeFile(
      path.join(__dirname, '/input/index.css'),
      'body { background: green }',
    );
    await bundleHtml();

    html = await outputFS.readFile(path.join(distDir, 'index.html'), 'utf8');
    let newFilename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/,
    )[1];
    assert(await outputFS.exists(path.join(distDir, newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function() {
    let inputDir = path.join(__dirname, 'input');
    let bundleJs = () => bundle(path.join(__dirname, 'input/index.js'));

    await ncp(path.join(__dirname, 'integration/import-raw'), inputDir);

    await bundleJs();

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    let filename = js.match(/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await outputFS.exists(path.join(distDir, filename)));

    await outputFS.writeFile(path.join(inputDir, 'test.txt'), 'hello world');
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
});
