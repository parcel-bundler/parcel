// @flow strict-local
import assert from 'assert';
import path from 'path';
import {
  bundler,
  describe,
  getNextBuild,
  inputFS,
  it,
} from '@atlaspack/test-utils';
import http from 'http';
import getPort from 'get-port';

const config = path.join(
  __dirname,
  './integration/custom-configs/.atlaspackrc-dev-server',
);

function apiServer() {
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.write('Request URL: ' + req.url);
      res.end();
    })
    .listen(9753);

  return server;
}

function get(file, port, client = http) {
  return new Promise((resolve, reject) => {
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

describe.v2('proxy', function () {
  let subscription;
  let cwd;
  let server;
  beforeEach(function () {
    cwd = inputFS.cwd();
  });

  afterEach(async () => {
    inputFS.chdir(cwd);
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = null;
    if (server) {
      await server.close();
    }
    server = null;
  });

  it('should handle proxy table written in .proxyrc', async function () {
    let dir = path.join(__dirname, 'integration/proxyrc');
    inputFS.chdir(dir);

    let port = await getPort();
    let b = bundler(path.join(dir, 'index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /api/get');
  });

  it('should handle proxy table written in .proxyrc.json', async function () {
    let dir = path.join(__dirname, 'integration/proxyrc-json');
    inputFS.chdir(dir);

    let port = await getPort();
    let b = bundler(path.join(dir, 'index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /api/get');
  });

  it('should handle proxy table written in .proxyrc.js', async function () {
    let dir = path.join(__dirname, 'integration/proxyrc-js');
    inputFS.chdir(dir);

    let port = await getPort();
    let b = bundler(path.join(dir, 'index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /get');
  });

  it('should handle proxy table written in .proxyrc.cjs', async function () {
    let dir = path.join(__dirname, 'integration/proxyrc-cjs');
    inputFS.chdir(dir);

    let port = await getPort();
    let b = bundler(path.join(dir, 'index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /get');
  });

  it('should handle proxy table written in .proxyrc.mjs', async function () {
    let dir = path.join(__dirname, 'integration/proxyrc-mjs');
    inputFS.chdir(dir);

    let port = await getPort();
    let b = bundler(path.join(dir, 'index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /get');
  });

  it('should handle proxy table written in .proxyrc.ts', async function () {
    let dir = path.join(__dirname, 'integration/proxyrc-ts');
    inputFS.chdir(dir);

    let port = await getPort();
    let b = bundler(path.join(dir, 'index.js'), {
      config,
      serveOptions: {
        https: false,
        port: port,
        host: 'localhost',
      },
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /get');
  });
});
