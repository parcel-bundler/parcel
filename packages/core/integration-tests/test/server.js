const assert = require('assert');
const path = require('path');
const fs = require('@parcel/fs');
const logger = require('@parcel/logger');
const {bundler} = require('@parcel/test-utils');
const http = require('http');
const https = require('https');
const getPort = require('get-port');
const sinon = require('sinon');

function get(file, port, client = http) {
  return new Promise((resolve, reject) => {
    client.get(
      {
        hostname: 'localhost',
        port: port,
        path: file,
        rejectUnauthorized: false
      },
      res => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject({statusCode: res.statusCode, data});
          }

          resolve(data);
        });
      }
    );
  });
}

function getNextBuild(b) {
  return new Promise((resolve, reject) => {
    let subscriptionPromise = b
      .watch((err, buildEvent) => {
        if (err) {
          reject(err);
          return;
        }

        subscriptionPromise
          .then(subscription => subscription.unsubscribe())
          .then(() => {
            resolve(buildEvent);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

describe('server', function() {
  let subscription;

  afterEach(async () => {
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = null;
  });

  it('should serve files', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js', port);
    let distFile = await fs.readFile(
      path.join(__dirname, '../dist/index.js'),
      'utf8'
    );

    assert.equal(data, distFile);
  });

  // TODO: Implement this once HTMLTransformer is in
  it.skip('should serve a default page if the main bundle is an HTML asset', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/', port);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '../dist/index.html'), 'utf8')
    );

    data = await get('/foo/bar', port);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '../dist/index.html'), 'utf8')
    );
  });

  it('should serve a 404 if the file does not exist', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let statusCode = 200;
    try {
      await get('/fake.js', port);
    } catch (err) {
      statusCode = err.statusCode;
    }

    assert.equal(statusCode, 404);
  });

  it('should serve a 500 if the bundler errored', async function() {
    let port = await getPort();
    let inputDir = path.join(__dirname, '/input/server-500');
    await fs.ncp(path.join(__dirname, '/integration/commonjs'), inputDir);
    let entry = path.join(inputDir, 'index.js');

    let b = bundler(entry, {
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);
    await fs.writeFile(path.join(inputDir, 'local.js'), 'syntax\\error');

    // Await the second build failing (which means resolving with
    // a buildFailure event)
    await getNextBuild(b);

    let statusCode = 200;
    try {
      await get('/index.js', port);
    } catch (err) {
      statusCode = err.statusCode;
      assert(err.data.includes('Expecting Unicode escape sequence'));
    } finally {
      await subscription.unsubscribe();
    }

    assert.equal(statusCode, 500);
  });

  it('should support HTTPS', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      serve: {
        https: true,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js', port, https);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '../dist/index.js'), 'utf8')
    );
  });

  it('should support HTTPS via custom certificate', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      serve: {
        https: {
          key: path.join(__dirname, '/integration/https/private.pem'),
          cert: path.join(__dirname, '/integration/https/primary.crt')
        },
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js', port, https);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '../dist/index.js'), 'utf8')
    );
  });

  it('should support setting a public url', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      serve: {
        https: false,
        port: port,
        host: 'localhost',
        publicUrl: '/dist'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/dist/index.js', port);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '../dist/index.js'), 'utf8')
    );
  });

  // TODO: Update this when static assets are a thing in JS
  it.skip('should serve static assets as well as html', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      serve: {
        https: false,
        port: port,
        host: 'localhost',
        publicUrl: '/dist'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    // When accessing / we should get the index page.
    let data = await get('/', port);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8')
    );

    // When accessing /hello.txt we should get txt document.
    await fs.writeFile(path.join(__dirname, '/dist/hello.txt'), 'hello');
    data = await get('/hello.txt', port);
    assert.equal(data, 'hello');
  });

  it.skip('should work with query parameters that contain a dot', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js?foo=bar.baz', port);
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '../dist/index.js'), 'utf8')
    );
  });

  it.skip('should work with paths that contain a dot', async function() {
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      publicUrl: '/'
    });
    await b.serve(0);

    let data = await get('/bar.baz');
    assert.equal(
      data,
      await fs.readFile(path.join(__dirname, '/dist/index.html'), 'utf8')
    );
  });

  it.skip('should not log dev server access for log level <= 3', async function() {
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      publicUrl: '/'
    });
    await b.serve(0);
    const spy = sinon.spy(logger, '_log');
    await get('/');

    assert(!spy.called);

    // restore back defaults
    logger._log.restore();
  });

  it.skip('should log dev server access for log level > 3', async function() {
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      publicUrl: '/'
    });
    await b.serve(0);
    logger.setOptions({logLevel: 4});
    const spy = sinon.spy(logger, '_log');

    assert(!spy.called);

    await get('/');

    assert(spy.calledOnce);
    // partial matching for call args, since port is a moving target
    assert(spy.args[0][0].includes('Request: http://localhost'));

    // restore back defaults
    logger._log.restore();
    logger.setOptions({logLevel: 3});
  });
});
