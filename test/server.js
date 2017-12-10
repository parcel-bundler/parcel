const assert = require('assert');
const fs = require('fs');
const {bundler, run, assertBundleTree} = require('./utils');
const http = require('http');

describe('server', function() {
  let server;
  afterEach(function() {
    if (server) {
      server.close();
      server = null;
    }
  });

  function get(file) {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:' + server.address().port + file, res => {
        if (res.statusCode !== 200) {
          return reject(new Error('Request failed: ' + res.statusCode));
        }

        res.setEncoding('utf8');
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          resolve(data);
        });
      });
    });
  }

  it('should serve files', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    server = b.serve(0);

    let data = await get('/dist/index.js');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.js', 'utf8'));
  });

  it('should serve a default page if the main bundle is an HTML asset', async function() {
    let b = bundler(__dirname + '/integration/html/index.html');
    server = b.serve(0);

    let data = await get('/');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.html', 'utf8'));

    data = await get('/foo/bar');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.html', 'utf8'));
  });

  it('should serve a 404 if the file does not exist', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    server = b.serve(0);

    let threw = false;
    try {
      await get('/dist/fake.js');
    } catch (err) {
      threw = true;
    }

    assert(threw);
  });

  it('should serve a 500 if the bundler errored', async function() {
    let b = bundler(__dirname + '/integration/html/index.html');
    server = b.serve(0);

    b.errored = true;

    try {
      await get('/');
      throw new Error('GET / responded with 200');
    } catch (err) {
      assert.equal(err.message, 'Request failed: 500');
    }

    b.errored = false;
    await get('/');
  });
});
