import assert from 'assert';
import path from 'path';
import {bundle as _bundle, distDir, overlayFS} from '@parcel/test-utils';

function bundle(path) {
  return _bundle(path, {
    disableCache: false,
    distDir,
    inputFS: overlayFS,
  });
}

describe('content hashing', function() {
  it('should update content hash when content changes', async function() {
    let fixtureDir = path.join(__dirname, 'integration/html-css');
    await overlayFS.mkdirp(fixtureDir);

    let bundleHtml = () => bundle(path.join(fixtureDir, 'index.html'));
    await bundleHtml();

    let html = await overlayFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    let filename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(html-css\.[a-f0-9]+\.css)">/,
    )[1];
    assert(await overlayFS.exists(path.join(distDir, filename)));

    await overlayFS.writeFile(
      path.join(fixtureDir, 'index.css'),
      'body { background: green }',
    );
    await bundleHtml();

    html = await overlayFS.readFile(path.join(distDir, 'index.html'), 'utf8');
    let newFilename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(html-css\.[a-f0-9]+\.css)">/,
    )[1];
    assert(await overlayFS.exists(path.join(distDir, newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function() {
    let fixtureDir = path.join(__dirname, 'integration/import-raw');
    await overlayFS.mkdirp(fixtureDir);

    let bundleJs = () => bundle(path.join(fixtureDir, 'index.js'));
    await bundleJs();

    let js = await overlayFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    let filename = js.match(/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await overlayFS.exists(path.join(distDir, filename)));

    await overlayFS.writeFile(path.join(fixtureDir, 'test.txt'), 'hello world');
    await bundleJs();

    js = await overlayFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    let newFilename = js.match(/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await overlayFS.exists(path.join(distDir, newFilename)));

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
