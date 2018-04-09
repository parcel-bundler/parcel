const assert = require('assert');
const fs = require('fs');
const {bundle, tmpPath} = require('./utils');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));

describe('content hashing', function() {
  it('should update content hash when content changes', async function() {
    await ncp(__dirname + '/integration/html-css', tmpPath('input'));

    await bundle(tmpPath('input', 'index.html'), {
      production: true
    });

    let html = fs.readFileSync(tmpPath('dist', 'index.html'), 'utf8');
    let filename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/
    )[1];
    assert(fs.existsSync(tmpPath('dist', filename)));

    fs.writeFileSync(
      tmpPath('input', 'index.css'),
      'body { background: green }'
    );

    await bundle(tmpPath('input', 'index.html'), {
      production: true
    });

    html = fs.readFileSync(tmpPath('dist', 'index.html'), 'utf8');
    let newFilename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/
    )[1];
    assert(fs.existsSync(tmpPath('dist', newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function() {
    await ncp(__dirname + '/integration/import-raw', tmpPath('input'));

    await bundle(tmpPath('input', 'index.js'), {
      production: true
    });

    let js = fs.readFileSync(tmpPath('dist', 'index.js'), 'utf8');
    let filename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(fs.existsSync(tmpPath('dist', filename)));

    fs.writeFileSync(tmpPath('input', 'test.txt'), 'hello world');

    await bundle(tmpPath('input', 'index.js'), {
      production: true
    });

    js = fs.readFileSync(tmpPath('dist', 'index.js'), 'utf8');
    let newFilename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(fs.existsSync(tmpPath('dist', newFilename)));

    assert.notEqual(filename, newFilename);
  });
});
