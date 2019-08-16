import assert from 'assert';
import path from 'path';
import {bundle as _bundle, distDir, inputFS as fs} from '@parcel/test-utils';

function bundle(path) {
  return _bundle(path, {
    disableCache: false,
    inputFS: fs,
    // These tests must use the real fs as they rely on the watcher
    outputFS: fs
  });
}

describe('content hashing', function() {
  beforeEach(async function() {
    await fs.rimraf(path.join(__dirname, '/input'));
  });

  it('should update content hash when content changes', async function() {
    await fs.ncp(
      path.join(__dirname, '/integration/html-css'),
      path.join(__dirname, '/input')
    );

    let bundleHtml = () => bundle(path.join(__dirname, '/input/index.html'));
    await bundleHtml();

    let html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
    let filename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/
    )[1];
    assert(await fs.exists(path.join(distDir, filename)));

    await fs.writeFile(
      path.join(__dirname, '/input/index.css'),
      'body { background: green }'
    );
    await bundleHtml();

    html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
    let newFilename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/
    )[1];
    assert(await fs.exists(path.join(distDir, newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function() {
    await fs.ncp(
      path.join(__dirname, '/integration/import-raw'),
      path.join(__dirname, '/input')
    );

    let bundleJs = () => bundle(path.join(__dirname, '/input/index.js'));
    await bundleJs();

    let js = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    let filename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await fs.exists(path.join(distDir, filename)));

    await fs.writeFile(path.join(__dirname, '/input/test.txt'), 'hello world');
    await bundleJs();

    js = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    let newFilename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await fs.exists(path.join(distDir, newFilename)));

    assert.notEqual(filename, newFilename);
  });
});
