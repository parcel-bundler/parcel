// @flow strict-local
import assert from 'assert';
import invariant from 'assert';
import path from 'path';
import {
  bundler,
  getNextBuild,
  inputFS,
  outputFS,
  overlayFS,
  ncp,
} from '@parcel/test-utils';
import http from 'http';
import https from 'https';
import getPort from 'get-port';
import type {BuildEvent} from '@parcel/types';

const distDir = path.resolve(__dirname, '.parcel-cache/dist');
const config = path.join(
  __dirname,
  './integration/custom-configs/.parcelrc-dev-server',
);

function get(file, port, client = http) {
  return new Promise((resolve, reject) => {
    // $FlowFixMe
    client.get(
      {
        hostname: 'localhost',
        port: port,
        path: file,
        rejectUnauthorized: false,
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
      },
    );
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
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js', port);
    let distFile = await outputFS.readFile(
      path.join(distDir, 'index.js'),
      'utf8',
    );

    assert.equal(data, distFile);
  });

  it('should serve source files', async function() {
    let port = await getPort();
    let inputPath = path.join(__dirname, '/integration/commonjs/index.js');
    let b = bundler(inputPath, {
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get(
      '/__parcel_source_root/integration/commonjs/index.js',
      port,
    );
    let inputFile = await inputFS.readFile(inputPath, 'utf8');

    assert.equal(data, inputFile);
  });

  it('should serve a default page if the main bundle is an HTML asset', async function() {
    let port = await getPort();
    let inputPath = path.join(__dirname, '/integration/html/index.html');
    let b = bundler(inputPath, {
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let outputFile = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );

    let data = await get('/', port);
    assert.equal(data, outputFile);

    data = await get('/foo/bar', port);
    assert.equal(data, outputFile);
  });

  it('should serve a default page if the main bundle is an HTML asset with package.json#source', async function() {
    let port = await getPort();
    let inputPath = path.join(__dirname, '/integration/html-pkg-source/');
    let b = bundler(inputPath, {
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    let event: BuildEvent = await getNextBuild(b);
    invariant(event.type === 'buildSuccess');
    let bundleGraph = event.bundleGraph;

    let outputFile = await outputFS.readFile(
      bundleGraph.getBundles()[0].filePath,
      'utf8',
    );

    let data = await get('/', port);
    assert.equal(data, outputFile);

    data = await get('/foo/bar', port);
    assert.equal(data, outputFile);
  });

  it('should serve a 404 if the file does not exist', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
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
    await ncp(path.join(__dirname, '/integration/babel'), inputDir);
    let entry = path.join(inputDir, 'index.js');

    let b = bundler(entry, {
      inputFS: overlayFS,
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);
    await outputFS.writeFile(path.join(inputDir, 'foo.js'), 'syntax\\error');

    // Await the second build failing (which means resolving with
    // a buildFailure event)
    await getNextBuild(b);

    let statusCode = 200;
    try {
      await get('/index.js', port);
    } catch (err) {
      statusCode = err.statusCode;
      assert(err.data.includes('Expecting Unicode escape sequence'));
    }

    assert.equal(statusCode, 500);
  });

  it('should support HTTPS', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      config,
      distDir,
      serveOptions: {
        https: true,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js', port, https);
    assert.equal(
      data,
      await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8'),
    );
  });

  it('should support HTTPS via custom certificate', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      config,
      distDir,
      serveOptions: {
        https: {
          key: path.join(__dirname, '/integration/https/private.pem'),
          cert: path.join(__dirname, '/integration/https/primary.crt'),
        },
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js', port, https);
    assert.equal(
      data,
      await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8'),
    );
  });

  it('should support setting a public url', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
        publicUrl: '/dist',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/dist/index.js', port);
    assert.equal(
      data,
      await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8'),
    );
  });

  it('should work with query parameters that contain a dot', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/index.js?foo=bar.baz', port);
    assert.equal(
      data,
      await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8'),
    );
  });

  it('should work with paths that contain a dot', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/integration/html/index.html'), {
      config,
      distDir,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    let data = await get('/bar.baz', port);
    assert.equal(
      data,
      await outputFS.readFile(path.join(distDir, 'index.html'), 'utf8'),
    );
  });
});
