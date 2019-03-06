const http = require('http');
const https = require('https');
const serveStatic = require('serve-static');
const getPort = require('get-port');
const serverErrors = require('./utils/customErrors').serverErrors;
const generateCertificate = require('./utils/generateCertificate');
const getCertificate = require('./utils/getCertificate');
const AnsiToHtml = require('ansi-to-html');
const logger = require('@parcel/logger');
const path = require('path');
const url = require('url');

const ansiToHtml = new AnsiToHtml({newline: true});

serveStatic.mime.define({
  'application/wasm': ['wasm']
});

function setHeaders(res) {
  enableCors(res);
}

function enableCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, HEAD, PUT, PATCH, POST, DELETE'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Content-Type'
  );
}

function middleware(bundler) {
  const serve = serveStatic(bundler.options.outDir, {
    index: false,
    redirect: false,
    setHeaders: setHeaders,
    dotfiles: 'allow'
  });

  return function(req, res, next) {
    logAccessIfVerbose();

    // Wait for the bundler to finish bundling if needed
    if (bundler.pending) {
      bundler.once('bundled', respond);
    } else {
      respond();
    }

    function respond() {
      let {pathname} = url.parse(req.url);
      if (bundler.error) {
        return send500(bundler.error);
      } else if (
        !pathname.startsWith(bundler.options.publicURL) ||
        path.extname(pathname) === ''
      ) {
        // If the URL doesn't start with the public path, or the URL doesn't
        // have a file extension, send the main HTML bundle.
        return sendIndex();
      } else {
        // Otherwise, serve the file from the dist folder
        req.url = pathname.slice(bundler.options.publicURL.length);
        return serve(req, res, sendIndex);
      }
    }

    function sendIndex() {
      // If the main asset is an HTML file, serve it
      if (bundler.mainBundle.type === 'html') {
        req.url = `/${path.basename(bundler.mainBundle.name)}`;
        serve(req, res, send404);
      } else {
        send404();
      }
    }

    function send500(error) {
      setHeaders(res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(500);
      let errorMesssge = '<h1>🚨 Build Error</h1>';
      if (process.env.NODE_ENV === 'production') {
        errorMesssge += '<p><b>Check the console for details.</b></p>';
      } else {
        const {message, stack} = logger.formatError(error, {color: true});
        errorMesssge += `<p><b>${message}</b></p>`;
        if (stack) {
          errorMesssge += `<div style="background: black; padding: 1rem;">${ansiToHtml.toHtml(
            stack
          )}</div>`;
        }
      }
      res.end(
        [
          `<!doctype html>`,
          `<head><title>🚨 Build Error</title></head>`,
          `<body style="font-family: monospace; white-space: pre;">${errorMesssge}</body>`
        ].join('')
      );
    }

    function send404() {
      if (next) {
        return next();
      }
      setHeaders(res);
      res.writeHead(404);
      res.end();
    }

    function logAccessIfVerbose() {
      const protocol = req.connection.encrypted ? 'https' : 'http';
      const fullUrl = `${protocol}://${req.headers.host}${req.url}`;

      logger.verbose(`Request: ${fullUrl}`);
    }
  };
}

async function serve(bundler, port, host, useHTTPS = false) {
  let handler = middleware(bundler);
  let server;
  if (!useHTTPS) {
    server = http.createServer(handler);
  } else if (typeof useHTTPS === 'boolean') {
    server = https.createServer(generateCertificate(bundler.options), handler);
  } else {
    server = https.createServer(await getCertificate(useHTTPS), handler);
  }

  let freePort = await getPort({port});
  server.listen(freePort, host);

  return new Promise((resolve, reject) => {
    server.on('error', err => {
      console.log(err);
      logger.error(new Error(serverErrors(err, server.address().port)));
      reject(err);
    });

    server.once('listening', () => {
      let addon =
        server.address().port !== port
          ? `- ${logger.chalk.yellow(
              `configured port ${port} could not be used.`
            )}`
          : '';

      logger.persistent(
        `Server running at ${logger.chalk.cyan(
          `${useHTTPS ? 'https' : 'http'}://${host || 'localhost'}:${
            server.address().port
          }`
        )} ${addon}`
      );

      resolve(server);
    });
  });
}

exports.middleware = middleware;
exports.serve = serve;
