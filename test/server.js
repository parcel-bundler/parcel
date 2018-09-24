const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
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
          res.setEncoding('utf8');
          let data = '';
          res.on('data', c => (data += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              return reject(data);
            }
            resolve(data);
          });
        }
      );
    });
  }

  it('should serve files', async function() {
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'));
    server = await b.serve(0);

    let data = await get('/index.js');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8')
    );
  });

  it('should serve a default page if the main bundle is an HTML asset', async function() {
    let b = bundler(path.join(__dirname, '/integration/html/index.html'));
    server = await b.serve(0);

    let data = await get('/');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8')
    );

    data = await get('/foo/bar');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8')
    );
  });

  it('should serve a 404 if the file does not exist', async function() {
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'));
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
    let b = bundler(path.join(__dirname, '/integration/html/index.html'));
    server = await b.serve(0);

    b.errored = true;

    try {
      await get('/');
    } catch (err) {
      assert.equal(err.message, 'Request failed: 500');
    }

    b.errored = false;
    await get('/');
  });

  it('should serve a 500 response with error stack trace when bundler has errors', async function() {
    let b = bundler(
      path.join(__dirname, '/integration/bundler-error-syntax-error/index.html')
    );

    server = await b.serve(0);
    let resp;
    try {
      await get('/');
    } catch (e) {
      resp = e;
    }

    assert(resp.includes('<title>🚨 Build Error</title>'), 'has title');
    assert(resp.includes('<h1>🚨 Build Error</h1>'), 'has h1');
    assert(
      resp.includes('<div style="background: black; padding: 1rem;">'),
      'has code frame'
    );
    assert(resp.includes('invalid_js'), 'code frame has invalid code');
  });

  it('should serve a 500 response without stack trace when bundler has errors in production', async function() {
    let NODE_ENV = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let b = bundler(
      path.join(__dirname, '/integration/bundler-error-syntax-error/index.html')
    );

    server = await b.serve(0);
    let resp;
    try {
      await get('/');
    } catch (e) {
      resp = e;
    }

    assert(resp.includes('<title>🚨 Build Error</title>'), 'has title');
    assert(resp.includes('<h1>🚨 Build Error</h1>'), 'has h1');
    assert(
      resp.includes('<p><b>Check the console for details.</b></p>'),
      'has description'
    );
    assert(
      !resp.includes('<div style="background: black; padding: 1rem;">'),
      'do not have code frame'
    );
    assert(!resp.includes('invalid_js'), 'source code is not shown');
    process.env.NODE_ENV = NODE_ENV;
  });

  it('should support HTTPS', async function() {
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'));
    server = await b.serve(0, true);

    let data = await get('/index.js', https);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8')
    );
  });

  it('should support HTTPS via custom certificate', async function() {
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'));
    server = await b.serve(0, {
      key: path.join(__dirname, '/integration/https/private.pem'),
      cert: path.join(__dirname, '/integration/https/primary.crt')
    });

    let data = await get('/index.js', https);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8')
    );
  });

  it('should support setting a public url', async function() {
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      publicUrl: '/dist'
    });
    server = await b.serve(0);

    let data = await get('/dist/index.js');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8')
    );
  });

  it('should serve static assets as well as html', async function() {
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      publicUrl: '/'
    });
    server = await b.serve(0);
    // When accessing / we should get the index page.
    let data = await get('/');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8')
    );
    // When accessing /hello.txt we should get txt document.
    await fs.writeFile(path.join(__dirname, '/dist/hello.txt'), 'hello');
    data = await get('/hello.txt');
    assert.equal(data, 'hello');
  });

  it('should work with query parameters that contain a dot', async function() {
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      publicUrl: '/'
    });
    server = await b.serve(0);

    let data = await get('/?foo=bar.baz');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8')
    );
  });
});
