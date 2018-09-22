const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {bundle, rimraf, ncp} = require('./utils');

describe('content hashing', function() {
  beforeEach(async function() {
    await rimraf(path.join(__dirname, '/input'));
  });

  it('should update content hash when content changes', async function() {
    await ncp(
      path.join(__dirname, '/integration/html-css'),
      path.join(__dirname, '/input')
    );

    await bundle(path.join(__dirname, '/input/index.html'), {
      production: true
    });

    let html = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8'
    );
    let filename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/
    )[1];
    assert(await fs.exists(path.join(__dirname, '/dist/', filename)));

    await fs.writeFile(
      path.join(__dirname, '/input/index.css'),
      'body { background: green }'
    );

    await bundle(path.join(__dirname, '/input/index.html'), {
      production: true
    });

    html = await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8');
    let newFilename = html.match(
      /<link rel="stylesheet" href="[/\\]{1}(input\.[a-f0-9]+\.css)">/
    )[1];
    assert(await fs.exists(path.join(__dirname, '/dist/', newFilename)));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function() {
    await ncp(
      path.join(__dirname, '/integration/import-raw'),
      path.join(__dirname, '/input')
    );

    await bundle(path.join(__dirname, '/input/index.js'), {
      production: true
    });

    let js = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let filename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await fs.exists(path.join(__dirname, '/dist/', filename)));

    await fs.writeFile(path.join(__dirname, '/input/test.txt'), 'hello world');

    await bundle(path.join(__dirname, '/input/index.js'), {
      production: true
    });

    js = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let newFilename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(await fs.exists(path.join(__dirname, '/dist/', newFilename)));

    assert.notEqual(filename, newFilename);
  });
});
