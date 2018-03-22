const assert = require('assert');
const fs = require('fs');
const {bundler} = require('./utils');
const http = require('http');
const https = require('https');

describe('server', function() {
  let server;
  afterEach(function() {
    if (server) {
      server.close();
      server = null;
    }
  });

  function get(file, client = http) {
    return new Promise((resolve, reject) => {
      client.get(
        {
          hostname: 'localhost',
          port: server.address().port,
          path: file,
          rejectUnauthorized: false
        },
        res => {
          if (res.statusCode !== 200) {
            return reject(new Error('Request failed: ' + res.statusCode));
          }

          res.setEncoding('utf8');
          let data = '';
          res.on('data', c => (data += c));
          res.on('end', () => {
            resolve(data);
          });
        }
      );
    });
  }

  it('should serve files', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    server = await b.serve(0);

    let data = await get('/index.js');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.js', 'utf8'));
  });

  it('should serve a default page if the main bundle is an HTML asset', async function() {
    let b = bundler(__dirname + '/integration/html/index.html');
    server = await b.serve(0);

    let data = await get('/');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.html', 'utf8'));

    data = await get('/foo/bar');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.html', 'utf8'));
  });

  it('should serve a 404 if the file does not exist', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    server = await b.serve(0);

    let threw = false;
    try {
      await get('/fake.js');
    } catch (err) {
      threw = true;
    }

    assert(threw);
  });

  it('should serve a 500 if the bundler errored', async function() {
    let b = bundler(__dirname + '/integration/html/index.html');
    server = await b.serve(0);

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

  it('should support HTTPS', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    server = await b.serve(0, true);

    let data = await get('/index.js', https);
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.js', 'utf8'));
  });

  it('should support HTTPS via custom certificate', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    server = await b.serve(0, {
      key: __dirname + '/integration/https/private.pem',
      cert: __dirname + '/integration/https/primary.crt'
    });

    let data = await get('/index.js', https);
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.js', 'utf8'));
  });

  it('should support setting a public url', async function() {
    let b = bundler(__dirname + '/integration/commonjs/index.js', {
      publicUrl: '/dist'
    });
    server = await b.serve(0);

    let data = await get('/dist/index.js');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.js', 'utf8'));
  });

  it('should serve static assets as well as html', async function() {
    let b = bundler(__dirname + '/integration/html/index.html', {
      publicUrl: '/'
    });
    server = await b.serve(0);
    // When accessing / we should get the index page.
    let data = await get('/');
    assert.equal(data, fs.readFileSync(__dirname + '/dist/index.html', 'utf8'));
    // When accessing /hello.txt we should get txt document.
    fs.writeFileSync(__dirname + '/dist/hello.txt', 'hello');
    data = await get('/hello.txt');
    assert.equal(data, 'hello');
  });
});
