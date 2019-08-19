const assert = require('assert');
const path = require('path');
const logger = require('@parcel/logger');
const {
  bundler,
  getNextBuild,
  ncp,
  sleep,
  inputFS,
  defaultConfig
} = require('@parcel/test-utils');
const http = require('http');
const getPort = require('get-port');

const inputDir = path.resolve(__dirname, './input');
const config = {
  ...defaultConfig,
  reporters: ['@parcel/reporter-dev-server']
};

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

describe('proxy', function() {
  let subscription;
  let cwd;
  let server;
  beforeEach(async function() {
    await sleep(100);
    await inputFS.rimraf(inputDir);
    await sleep(100);
    cwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(cwd);
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = null;
    if (server) {
      await server.close();
    }
    server = null;
  });

  it('should handle proxy table written in .proxyrc', async function() {
    await ncp(path.join(__dirname, 'integration/proxyrc'), inputDir);
    process.chdir(inputDir);

    let port = await getPort();
    let b = bundler(path.join(inputDir, 'index.js'), {
      // the server doesn't support custom file systems due to it's use of the `send` module.
      outputFS: inputFS,
      config,
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);

    server = apiServer();

    let data = await get('/index.js', port);
    assert.notEqual(data, 'Request URL: /index.js');

    data = await get('/api/get', port);
    assert.equal(data, 'Request URL: /api/get');
  });

  it('should handle proxy table written in .proxyrc.js', async function() {
    await ncp(path.join(__dirname, 'integration/proxyrc-js'), inputDir);
    process.chdir(inputDir);

    let port = await getPort();
    let b = bundler(path.join(inputDir, 'index.js'), {
      // the server doesn't support custom file systems due to it's use of the `send` module.
      outputFS: inputFS,
      config,
      serve: {
        https: false,
        port: port,
        host: 'localhost'
      }
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
