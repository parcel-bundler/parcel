const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const serveStatic = require('serve-static');
const getPort = require('get-port');
const serverErrors = require('./utils/customErrors').serverErrors;
const generateCertificate = require('./utils/generateCertificate');

function middleware(bundler) {
  const serve = serveStatic(bundler.options.outDir, {index: false});
  const root = path.resolve(bundler.options.outDir);

  return function(req, res, next) {
    // Wait for the bundler to finish bundling if needed
    if (bundler.pending) {
      bundler.once('bundled', respond);
    } else {
      respond();
    }

    function respond() {
      if (bundler.errored) {
        return send500();
      } else {
        // If the url starts with the publicURL, remove it
        if (req.url.startsWith(bundler.options.publicURL)) {
          req.url = req.url.slice(bundler.options.publicURL.length);
        }
        // Resolve to the canonical path of the resource
        const resource = path.resolve(path.join(root, req.url));
        if (resource === root || !fs.existsSync(resource)) {
          // If we're asking for the root, or the requested resource doesn't exist, send the index
          sendIndex();
        } else {
          // Otherwise send the resource
          return serve(req, res, send404);
        }
      }
    }

    function sendIndex() {
      // If the main asset is an HTML file, serve it
      if (bundler.mainAsset.type === 'html') {
        req.url = `/${bundler.mainAsset.generateBundleName()}`;
        serve(req, res, send404);
      } else {
        send404();
      }
    }

    function send500() {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(500);
      res.end('🚨 Build error, check the console for details.');
    }

    function send404() {
      if (next) {
        return next();
      }

      res.writeHead(404);
      res.end();
    }
  };
}

async function serve(bundler, port, useHTTPS = false) {
  let handler = middleware(bundler);
  let server = useHTTPS
    ? https.createServer(generateCertificate(bundler.options), handler)
    : http.createServer(handler);

  let freePort = await getPort({port});
  server.listen(freePort);

  return new Promise((resolve, reject) => {
    server.on('error', err => {
      bundler.logger.error(new Error(serverErrors(err, server.address().port)));
      reject(err);
    });

    server.once('listening', () => {
      let addon =
        server.address().port !== port
          ? `- ${bundler.logger.chalk.yellow(
              `configured port ${port} could not be used.`
            )}`
          : '';

      bundler.logger.persistent(
        `Server running at ${bundler.logger.chalk.cyan(
          `${useHTTPS ? 'https' : 'http'}://localhost:${server.address().port}`
        )} ${addon}`
      );

      resolve(server);
    });
  });
}

exports.middleware = middleware;
exports.serve = serve;
