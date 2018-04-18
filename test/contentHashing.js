const assert = require('assert');
const fs = require('fs');
const {bundle, generateTimeKey} = require('./utils');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const path = require('path');

describe('content hashing', function() {
  it('should update content hash when content changes', async function() {
    let inputDir = __dirname + `/input/${generateTimeKey()}`;
    await ncp(__dirname + '/integration/html-css', inputDir);

    let b = await bundle(inputDir + '/index.html', {
      production: true
    });

    let html = fs.readFileSync(
      b.entryAsset.options.outDir + '/index.html',
      'utf8'
    );
    let regex = new RegExp(
      `<link rel="stylesheet" href="[/\\\\]{1}(${path.basename(
        inputDir
      )}\\.[a-f0-9]+\\.css)">`
    );
    let filename = html.match(regex)[1];
    assert(fs.existsSync(b.entryAsset.options.outDir + '/' + filename));

    fs.writeFileSync(inputDir + '/index.css', 'body { background: green }');

    b = await bundle(inputDir + '/index.html', {
      production: true
    });

    html = fs.readFileSync(b.entryAsset.options.outDir + '/index.html', 'utf8');
    let newFilename = html.match(regex)[1];
    assert(fs.existsSync(b.entryAsset.options.outDir + '/' + newFilename));

    assert.notEqual(filename, newFilename);
  });

  it('should update content hash when raw asset changes', async function() {
    let inputDir = __dirname + `/input/${generateTimeKey()}`;
    await ncp(__dirname + '/integration/import-raw', inputDir);

    let b = await bundle(inputDir + '/index.js', {
      production: true
    });

    let js = fs.readFileSync(b.entryAsset.options.outDir + '/index.js', 'utf8');
    let filename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(fs.existsSync(b.entryAsset.options.outDir + '/' + filename));

    fs.writeFileSync(inputDir + '/test.txt', 'hello world');

    b = await bundle(inputDir + '/index.js', {
      production: true
    });

    js = fs.readFileSync(b.entryAsset.options.outDir + '/index.js', 'utf8');
    let newFilename = js.match(/\/(test\.[0-9a-f]+\.txt)/)[1];
    assert(fs.existsSync(b.entryAsset.options.outDir + '/' + newFilename));

    assert.notEqual(filename, newFilename);
  });
});
